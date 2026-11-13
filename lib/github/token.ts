import "server-only";

import { open, seal, tailOf } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";
import { GithubError, getViewer } from "./read";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;

export type Connection = {
  login: string;
  scopes: string[];
  lastFour: string;
  /** Whether a pasted token or an OAuth grant stored this row. */
  via: "token" | "oauth";
};

type Row = {
  login: string;
  scopes: string[] | null;
  token_last_four: string;
  connected_via?: string | null;
  token_sealed?: string;
};

function viaOf(row: Row): "token" | "oauth" {
  return row.connected_via === "oauth" ? "oauth" : "token";
}

function requireSealKey(): string {
  const key = serverEnv().githubTokenKey;

  if (!key || key.trim().length === 0) {
    throw new GithubError(
      "unavailable",
      "GITHUB_TOKEN_KEY is not set on the server, so a GitHub token cannot be sealed. The setup page lists it."
    );
  }

  return key;
}

/** Metadata only — this never selects the sealed column. */
export async function readConnection(
  supabase: Client,
  owner: string
): Promise<Connection | null> {
  const { data, error } = await supabase
    .from("github_connections")
    .select("login, scopes, token_last_four, connected_via")
    .eq("owner", owner)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as Row;

  return {
    login: row.login,
    scopes: row.scopes ?? [],
    lastFour: row.token_last_four,
    via: viaOf(row),
  };
}

/**
 * The token, opened for the duration of one request.
 *
 * It is never cached, never logged and never returned to a component — the
 * caller passes it straight to a GitHub read.
 */
export async function readToken(
  supabase: Client,
  owner: string
): Promise<{ token: string; connection: Connection } | null> {
  const { data, error } = await supabase
    .from("github_connections")
    .select("login, scopes, token_last_four, connected_via, token_sealed")
    .eq("owner", owner)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as Row & { token_sealed: string };
  const connection: Connection = {
    login: row.login,
    scopes: row.scopes ?? [],
    lastFour: row.token_last_four,
    via: viaOf(row),
  };

  let token: string;
  try {
    token = open(row.token_sealed, requireSealKey());
  } catch (caught) {
    if (caught instanceof GithubError) throw caught;
    throw new GithubError(
      "unauthorized",
      "The stored GitHub token cannot be opened with this GITHUB_TOKEN_KEY. Reconnect GitHub."
    );
  }

  return { token, connection };
}

/**
 * Verifies the token against GitHub before storing it, so a typo is a message
 * rather than a workspace that fails on every later request.
 */
export async function saveConnection(
  supabase: Client,
  owner: string,
  token: string,
  via: "token" | "oauth" = "token"
): Promise<Connection> {
  const key = requireSealKey();
  const viewer = await getViewer(token);
  const connection: Connection = {
    login: viewer.login,
    scopes: viewer.scopes,
    lastFour: tailOf(token),
    via,
  };

  const { error } = await supabase.from("github_connections").upsert(
    {
      owner,
      login: viewer.login,
      scopes: viewer.scopes,
      token_sealed: seal(token, key),
      token_last_four: connection.lastFour,
      connected_via: via,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner" }
  );

  if (error) throw new GithubError("unavailable", error.message);

  return connection;
}
