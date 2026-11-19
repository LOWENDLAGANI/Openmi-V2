/**
 * TEMPORARY GUEST MODE — remove before publishing.
 *
 * Set `GUEST_MODE` to false (or delete this file and the three import sites in
 * `lib/session.ts`, `middleware.ts` and `app/layout.tsx`) and the app returns to
 * real Supabase sessions. Nothing else references it.
 *
 * While it is on, every request is treated as a signed-in guest with no
 * database: reads resolve to empty lists (or one sample profile so the account
 * pages render), writes go nowhere, and no GitHub token is used. It exists so
 * the interface can be reviewed without a Supabase project or a model key.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Session } from "./session";

/** The switch. Flip to false, or delete this file, before publishing. */
export const GUEST_MODE = true;

export function guestEnabled(): boolean {
  return GUEST_MODE;
}

const GUEST_ID = "00000000-0000-4000-8000-000000000001";
const GUEST_EMAIL = "guest@openmi.local";

/** Enough of a profile for the sidebar, chat composer and activity page. */
const PROFILE = {
  credit_balance: 24,
  wallet_credit: 0,
  credit_day: null,
  timezone: "UTC",
  has_paid: false,
  paid_until: null,
  invite_code: "GUEST01",
  invited_by: null,
  banned_at: null,
  ban_expires_at: null,
  ban_reason: null,
  display_name: "Guest",
};

/**
 * A connection row that is present but carries no token, so the chat page opens
 * on its composer instead of the "Connect GitHub" screen. Anything that tries to
 * read a repository fails with its normal "reconnect" message.
 */
const CONNECTION = {
  login: "guest",
  scopes: [] as string[],
  token_last_four: "0000",
  connected_via: "token",
  token_sealed: "",
};

type QueryResult = { data: unknown; error: null; count: number | null };

function result(data: unknown, count: number | null = null): QueryResult {
  return { data, error: null, count };
}

/**
 * A chainable, awaitable stand-in for a PostgREST query.
 *
 * Every filter returns the same node, awaiting resolves to an empty list, and
 * the two "one row" terminators answer with the sample profile or connection.
 * That is enough for the server components' read paths; a write resolves too,
 * and the page simply behaves as if the row was not stored.
 */
function tableQuery(table: string): unknown {
  const rows = result([], 0);

  const node: Record<string, unknown> = {};
  node.then = (onFulfilled: unknown, onRejected: unknown) =>
    Promise.resolve(rows).then(
      onFulfilled as (value: QueryResult) => unknown,
      onRejected as (reason: unknown) => unknown
    );

  const one = async () => {
    if (table === "profiles") return result(PROFILE);
    if (table === "github_connections") return result(CONNECTION);
    return result(null);
  };

  node.maybeSingle = one;
  node.single = one;
  node.csv = async () => ({ data: "", error: null });
  node.limit = () => node;
  node.order = () => node;
  node.eq = () => node;
  node.neq = () => node;
  node.gt = () => node;
  node.gte = () => node;
  node.lt = () => node;
  node.lte = () => node;
  node.in = () => node;
  node.is = () => node;
  node.or = () => node;
  node.range = () => node;
  node.insert = () => node;
  node.update = () => node;
  node.upsert = () => node;
  node.delete = () => node;
  node.select = () => node;
  node.returns = () => node;

  return new Proxy(node, {
    get(target, property) {
      if (typeof property !== "string") {
        return Reflect.get(target, property);
      }
      if (property in target) return target[property];
      return () => node;
    },
  });
}

function guestClient(): SupabaseClient {
  const client = {
    from: (table: string) => tableQuery(table),
    rpc: (name: string) => {
      // The daily refill answers a number, so the header has a balance to show.
      // Anything that asks "is this account an admin?" gets a plain no.
      const data = name.includes("refill") ? 24 : null;
      return Promise.resolve({ data, error: null });
    },
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: GUEST_ID,
            email: GUEST_EMAIL,
            email_confirmed_at: new Date().toISOString(),
            confirmed_at: new Date().toISOString(),
          },
        },
        error: null,
      }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signOut: async () => ({ error: null }),
    },
    storage: { from: () => tableQuery("storage") },
  };

  return client as unknown as SupabaseClient;
}

/**
 * Presentation only: every model row looks available, so the picker can be
 * reviewed without provider keys. Sending still fails as an unavailable
 * provider would, and no server check reads this flag.
 */
export function guestModels<T extends { available?: boolean }>(models: T[]): T[] {
  return models.map((model) => ({ ...model, available: true }));
}

/** The signed-in shape every page already understands. */
export function guestSession(): Extract<Session, { state: "signed-in" }> {
  return {
    state: "signed-in",
    supabase: guestClient() as Extract<
      Session,
      { state: "signed-in" }
    >["supabase"],
    user: { id: GUEST_ID, email: GUEST_EMAIL, emailVerified: true },
  };
}
