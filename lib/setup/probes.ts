import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getViewer } from "@/lib/github/read";
import { readToken } from "@/lib/github/token";
import {
  classifyProviderStatus,
  type Probe,
} from "@/lib/probe-status";
import { providerCatalogue, providerKey } from "@/lib/providers";
import type { Session } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Live probes for the setup page.
 *
 * Each probe is independent and reports its own failure. None of them prints a
 * key: a provider probe sends the key and reports only the status it got back.
 *
 * The probes are read-only. The provider check asks for a model list rather
 * than sending a completion, so a pass means the key authenticates — not that a
 * particular model is available or that a turn would be billed.
 */

export const PROBE_TIMEOUT_MS = 5_000;

async function probeSupabase(): Promise<Probe> {
  const admin = supabaseAdmin();

  if (!admin) {
    return {
      id: "supabase",
      label: "Supabase",
      state: "unconfigured",
      detail:
        "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not both set.",
      fix: "Set both, then redeploy; the setup table above names each one.",
    };
  }

  try {
    const { error } = await admin.from("openmi_meta").select("key").limit(1);

    if (error) {
      return {
        id: "supabase",
        label: "Supabase",
        state: "failed",
        detail: `The database answered: ${error.message}`,
        fix: "Check the project URL and service-role key, then apply the migrations.",
      };
    }

    return {
      id: "supabase",
      label: "Supabase",
      state: "ok",
      detail: "The service role reached the schema marker table.",
    };
  } catch (error) {
    return {
      id: "supabase",
      label: "Supabase",
      state: "failed",
      detail:
        error instanceof Error
          ? `The database could not be reached: ${error.message}`
          : "The database could not be reached.",
      fix: "Check the project URL and network access from this deployment.",
    };
  }
}

async function probeRls(): Promise<Probe> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return {
      id: "rls",
      label: "RLS smoke test",
      state: "unconfigured",
      detail: "The Supabase URL and anon key are not both set.",
      fix: "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    };
  }

  try {
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await client.from("profiles").select("id").limit(1);

    if (error) {
      return {
        id: "rls",
        label: "RLS smoke test",
        state: "failed",
        detail: `The anon key could not read profiles: ${error.message}`,
        fix: "Apply every migration and confirm RLS is enabled on profiles.",
      };
    }

    if (data && data.length > 0) {
      return {
        id: "rls",
        label: "RLS smoke test",
        state: "failed",
        detail: `The anon key read ${data.length} profile row(s). RLS is not isolating them.`,
        fix: "Stop and fix the profiles select policy before exposing this deployment.",
      };
    }

    return {
      id: "rls",
      label: "RLS smoke test",
      state: "ok",
      detail: "The anon key reads no profile rows.",
    };
  } catch (error) {
    return {
      id: "rls",
      label: "RLS smoke test",
      state: "failed",
      detail:
        error instanceof Error
          ? `The anon client could not run: ${error.message}`
          : "The anon client could not run.",
      fix: "Check the URL and anon key, then retry.",
    };
  }
}

async function probeGithub(session: Session): Promise<Probe> {
  const base = {
    id: "github",
    label: "GitHub token",
  } as const;

  if (session.state === "unconfigured") {
    return {
      ...base,
      state: "unconfigured",
      detail: "Supabase is not configured, so there is no session to test.",
    };
  }

  if (session.state !== "signed-in") {
    return {
      ...base,
      state: "skipped",
      detail: "Sign in to test the connected GitHub token.",
    };
  }

  try {
    const github = await readToken(session.supabase, session.user.id);

    if (!github) {
      return {
        ...base,
        state: "skipped",
        detail: "No GitHub account is connected.",
        fix: "Connect a fine-grained token in the workspace.",
      };
    }

    const viewer = await getViewer(github.token);

    return {
      ...base,
      state: "ok",
      detail: `The sealed token opens and GitHub accepted it as @${viewer.login}.`,
    };
  } catch (error) {
    return {
      ...base,
      state: "failed",
      detail:
        error instanceof Error
          ? error.message
          : "The sealed token could not be opened.",
      fix: "Reconnect GitHub; if GITHUB_TOKEN_KEY changed, reconnecting is required.",
    };
  }
}

async function probeProviders(): Promise<Probe[]> {
  return Promise.all(
    providerCatalogue().map(async (provider) => {
      const base = {
        id: `provider:${provider.id}`,
        label: provider.keyName,
      } as const;

      const key = providerKey(provider);

      if (!key) {
        return {
          ...base,
          state: "skipped",
          detail: "No key is set for this provider.",
          fix: "Add the key to enable this provider.",
        };
      }

      const url = provider.endpoint.replace(/\/chat\/completions$/, "/models");

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${key}`,
          },
          cache: "no-store",
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });

        const classification = classifyProviderStatus(response.status);

        return { ...base, ...classification };
      } catch {
        return {
          ...base,
          state: "failed",
          detail: `The provider did not answer within ${PROBE_TIMEOUT_MS / 1000} seconds.`,
          fix: "Check the provider's status page and network egress.",
        };
      }
    })
  );
}

/**
 * Sandbox configuration, not reachability.
 *
 * This deliberately does not create a sandbox to prove it can: a probe that
 * spends money to answer "is billing configured" is a probe that runs on every
 * setup page load. What it can prove is that a key exists and that the kill
 * switch is not holding it off, which is exactly what decides whether the
 * review card offers the button.
 */
async function probeExecution(): Promise<Probe> {
  const base = { id: "execution", label: "Sandbox verification" } as const;

  const key = process.env.E2B_API_KEY?.trim() ?? "";
  if (key.length === 0) {
    return {
      ...base,
      state: "unconfigured",
      detail: "E2B_API_KEY is not set, so runs cannot start and the card says so.",
      fix: "Create an API key in the E2B dashboard and add E2B_API_KEY.",
    };
  }

  const flag = (process.env.EXECUTION_ENABLED ?? "on").trim().toLowerCase();
  if (flag === "off" || flag === "false" || flag === "0") {
    return {
      ...base,
      state: "skipped",
      detail: "EXECUTION_ENABLED is off, so runs are disabled even though a key is present.",
      fix: "Unset EXECUTION_ENABLED or set it to on.",
    };
  }

  return {
    ...base,
    state: "ok",
    detail:
      "An E2B key is present. Runs start on demand; this probe does not create one.",
  };
}

export async function runSetupProbes(session: Session): Promise<Probe[]> {
  const [supabase, rls, github, execution, providers] = await Promise.all([
    probeSupabase(),
    probeRls(),
    probeGithub(session),
    probeExecution(),
    probeProviders(),
  ]);

  return [supabase, rls, github, execution, ...providers];
}
