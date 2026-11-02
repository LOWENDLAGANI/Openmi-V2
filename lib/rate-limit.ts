import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One rate limiter, two backends, and a rule about failure.
 *
 * Upstash is used when both of its variables are set. Otherwise the counter is
 * the `rate_limit_hit` function in Postgres, which every instance shares. If
 * neither is reachable the request is allowed and the result says `degraded`:
 * a limiter that fails closed turns a database hiccup into an outage, and the
 * setup page already reports that the limiter is missing.
 *
 * The bucket is derived from the account id, never from a cookie or an email, so
 * two accounts cannot share a counter by accident.
 */

export const RATE_LIMIT_WINDOW_MS = 60_000;

export const RATE_LIMITS = {
  chat: { max: 20, windowMs: RATE_LIMIT_WINDOW_MS },
  approval: { max: 10, windowMs: RATE_LIMIT_WINDOW_MS },
} as const;

export type RateLimitKind = keyof typeof RATE_LIMITS;
export type RateLimitSource = "upstash" | "postgres" | "degraded";

export type RateLimitResult = {
  allowed: boolean;
  hits: number;
  limit: number;
  retryAfterSeconds: number;
  source: RateLimitSource;
};

/** The start of the window a request at `now` falls into. */
export function windowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

/** A bucket name. Empty input is refused by the caller, not counted. */
export function rateBucket(kind: string, subject: string): string {
  const clean = subject.trim().slice(0, 120);
  return clean.length === 0 ? "" : `openmi:${kind}:${clean}`;
}

export function retryAfterSeconds(now: number, windowMs: number): number {
  const end = windowStart(now, windowMs) + windowMs;
  return Math.max(1, Math.ceil((end - now) / 1000));
}

async function hitUpstash(
  url: string,
  token: string,
  bucket: string,
  windowMs: number
): Promise<number | null> {
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", bucket],
        ["PEXPIRE", bucket, windowMs, "NX"],
      ]),
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });

    if (!response.ok) return null;

    const body = (await response.json()) as Array<{ result?: unknown }>;
    const hits = Number(body?.[0]?.result);

    return Number.isFinite(hits) && hits > 0 ? hits : null;
  } catch {
    return null;
  }
}

/**
 * Counts one hit and reports whether it is allowed.
 *
 * `env` and `now` are parameters so the decision is testable without a network
 * or a clock.
 */
export async function checkRateLimit(
  supabase: SupabaseClient | null,
  kind: RateLimitKind,
  subject: string,
  now: number = Date.now(),
  env: Record<string, string | undefined> = process.env
): Promise<RateLimitResult> {
  const spec = RATE_LIMITS[kind];
  const bucket = rateBucket(kind, subject);
  const base = {
    limit: spec.max,
    retryAfterSeconds: retryAfterSeconds(now, spec.windowMs),
  };

  if (bucket.length === 0) {
    return { ...base, allowed: true, hits: 0, source: "degraded" };
  }

  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    const hits = await hitUpstash(url, token, bucket, spec.windowMs);

    if (hits !== null) {
      return {
        ...base,
        allowed: hits <= spec.max,
        hits: Math.min(hits, spec.max),
        source: "upstash",
      };
    }
  }

  if (supabase) {
    const { data, error } = await supabase.rpc("rate_limit_hit", {
      p_bucket: bucket,
      p_window_start: new Date(windowStart(now, spec.windowMs)).toISOString(),
      p_max: spec.max,
    });

    const row = (Array.isArray(data) ? data[0] : data) as
      | { allowed?: unknown; hits?: unknown }
      | null;

    if (!error && row && typeof row.allowed === "boolean") {
      return {
        ...base,
        allowed: row.allowed,
        hits: Number(row.hits ?? spec.max),
        source: "postgres",
      };
    }
  }

  return { ...base, allowed: true, hits: 0, source: "degraded" };
}
