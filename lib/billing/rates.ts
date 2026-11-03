// Live ringgit exchange rates for the display-only estimate on /pay.
//
// The free currency-api dataset is fetched from two independent CDNs, so one
// being down does not leave the page without rates. A successful fetch is kept
// for six hours per server instance and also goes through Next's fetch cache;
// a failed one keeps serving the last good table, and the hand-written fallback
// in `lib/billing/currency.ts` covers a cold start with no network.

import { CURRENCY_CODES, DEFAULT_CURRENCY, type Currency } from "./currency";

/** Uppercase ISO code to units per 1 MYR. */
export type RateTable = Readonly<Record<string, number>>;

/** The shape of a fetch we accept, narrow enough for a test double. */
export type RateFetch = (url: string, init?: RequestInit) => Promise<Response>;

const SOURCES = [
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/myr.json",
  "https://latest.currency-api.pages.dev/v1/currencies/myr.json",
] as const;

export const RATE_TTL_MS = 6 * 60 * 60 * 1000;
const RATE_TTL_SECONDS = RATE_TTL_MS / 1000;
const REQUEST_TIMEOUT_MS = 3000;
const MAX_PLAUSIBLE_RATE = 1_000_000;

const KNOWN = new Set<string>(CURRENCY_CODES);

/**
 * Reads the `myr` table out of the dataset response. Unknown currencies,
 * non-numbers and implausible values are dropped rather than displayed.
 */
export function parseRates(payload: unknown): RateTable | null {
  if (!payload || typeof payload !== "object") return null;
  const table = (payload as { myr?: unknown }).myr;
  if (!table || typeof table !== "object" || Array.isArray(table)) return null;

  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(table as Record<string, unknown>)) {
    if (!KNOWN.has(code.toUpperCase())) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (value <= 0 || value > MAX_PLAUSIBLE_RATE) continue;
    rates[code.toUpperCase()] = value;
  }

  return Object.keys(rates).length > 0 ? rates : null;
}

/**
 * The same currency with the live rate applied. Returns the argument itself
 * when there is no usable rate, so callers can tell a live price from an
 * estimate by identity.
 */
export function withLiveRate(currency: Currency, rates: RateTable | null): Currency {
  if (!rates) return currency;
  // The charged currency is always one ringgit per ringgit.
  if (currency.code === DEFAULT_CURRENCY.code) return currency;
  const rate = rates[currency.code];
  if (!Number.isFinite(rate) || rate <= 0) return currency;
  return { ...currency, perMyr: rate };
}

type CacheEntry = { table: RateTable; expires: number };

let cache: CacheEntry | null = null;
let pending: Promise<RateTable | null> | null = null;

async function requestRates(fetchImpl: RateFetch): Promise<RateTable | null> {
  for (const url of SOURCES) {
    try {
      const init: RequestInit & { next: { revalidate: number } } = {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        next: { revalidate: RATE_TTL_SECONDS },
      };
      const response = await fetchImpl(url, init);
      if (!response.ok) continue;

      const table = parseRates(await response.json());
      if (table) return table;
    } catch {
      // Try the next source; a page view must not fail because rates did.
    }
  }

  return null;
}

/**
 * Rates per 1 MYR, from the six-hour cache when warm. Never throws: on failure
 * it returns the last good table, or null when there has never been one.
 */
export async function getMyrRates(
  options: { fetchImpl?: RateFetch; now?: number } = {}
): Promise<RateTable | null> {
  const now = options.now ?? Date.now();

  if (cache && cache.expires > now) return cache.table;
  if (pending) return pending;

  const fetchImpl = options.fetchImpl ?? fetch;

  pending = requestRates(fetchImpl)
    .then((table) => {
      if (table) cache = { table, expires: now + RATE_TTL_MS };
      return table ?? cache?.table ?? null;
    })
    .catch(() => cache?.table ?? null)
    .finally(() => {
      pending = null;
    });

  return pending;
}

/** Test hook: forget the in-process rates so a test starts cold. */
export function clearRateCache(): void {
  cache = null;
  pending = null;
}
