import { beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  RATE_TTL_MS,
  clearRateCache,
  getMyrRates,
  parseRates,
  withLiveRate,
  type RateFetch,
} from "../lib/billing/rates";
import { DEFAULT_CURRENCY, currencyForCountry } from "../lib/billing/currency";

const PAYLOAD = {
  date: "2026-11-02",
  myr: {
    usd: 0.23,
    sgd: 0.3,
    jpy: 34.1,
    // Unknown code, a crypto ticker and malformed values must all be dropped.
    xyz: 2,
    "1inch": 3.01,
    zero: 0,
    negative: -1,
    text: "0.5",
    huge: 10_000_000,
  },
};

function ok(body: unknown = PAYLOAD): RateFetch {
  return async () => new Response(JSON.stringify(body));
}

beforeEach(() => {
  clearRateCache();
});

test("the dataset is reduced to known currencies with usable numbers", () => {
  const rates = parseRates(PAYLOAD);
  expect(rates).not.toBeNull();
  expect(rates?.USD).toBe(0.23);
  expect(rates?.SGD).toBe(0.3);
  expect(rates?.JPY).toBe(34.1);
  expect(rates?.XYZ).toBeUndefined();
  expect(rates?.["1INCH"]).toBeUndefined();
  expect(rates?.ZERO).toBeUndefined();
  expect(rates?.NEGATIVE).toBeUndefined();
  expect(rates?.TEXT).toBeUndefined();
  expect(rates?.HUGE).toBeUndefined();
});

test("a response without a usable table is refused, not guessed", () => {
  expect(parseRates(null)).toBeNull();
  expect(parseRates("rates")).toBeNull();
  expect(parseRates({})).toBeNull();
  expect(parseRates({ myr: [] })).toBeNull();
  expect(parseRates({ myr: { xyz: 1 } })).toBeNull();
});

test("a live rate replaces the fallback, and ringgit stays one", () => {
  const usd = currencyForCountry("US");
  const live = withLiveRate(usd, { USD: 0.25 });

  expect(live.perMyr).toBe(0.25);
  expect(withLiveRate(DEFAULT_CURRENCY, { MYR: 2 }).perMyr).toBe(1);
  expect(withLiveRate(usd, null)).toBe(usd);
  expect(withLiveRate(usd, {})).toBe(usd);
  expect(withLiveRate(usd, { USD: 0 })).toBe(usd);
  expect(withLiveRate(usd, { USD: Number.NaN })).toBe(usd);
});

test("one fetch serves every page view inside the six-hour window", async () => {
  let calls = 0;
  const fetchImpl: RateFetch = async () => {
    calls += 1;
    return new Response(JSON.stringify(PAYLOAD));
  };

  const first = await getMyrRates({ fetchImpl, now: 1_000 });
  expect(first?.USD).toBe(0.23);

  const second = await getMyrRates({ fetchImpl, now: 1_000 + 60_000 });
  expect(second?.USD).toBe(0.23);
  expect(calls).toBe(1);

  await getMyrRates({ fetchImpl, now: 1_000 + RATE_TTL_MS + 1 });
  expect(calls).toBe(2);
});

test("concurrent page views share one in-flight request", async () => {
  let calls = 0;
  let release: (response: Response) => void = () => {};
  const gate = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const fetchImpl: RateFetch = async () => {
    calls += 1;
    return gate;
  };

  const a = getMyrRates({ fetchImpl, now: 1_000 });
  const b = getMyrRates({ fetchImpl, now: 1_000 });
  release(new Response(JSON.stringify(PAYLOAD)));

  expect((await a)?.USD).toBe(0.23);
  expect((await b)?.USD).toBe(0.23);
  expect(calls).toBe(1);
});

test("the second source is tried when the first one fails", async () => {
  const seen: string[] = [];
  const fetchImpl: RateFetch = async (url) => {
    seen.push(url);
    if (seen.length === 1) return new Response("nope", { status: 502 });
    return new Response(JSON.stringify(PAYLOAD));
  };

  const rates = await getMyrRates({ fetchImpl, now: 1_000 });
  expect(rates?.USD).toBe(0.23);
  expect(seen.length).toBe(2);
});

test("an outage keeps the last good table instead of failing the page", async () => {
  const good = await getMyrRates({ fetchImpl: ok(), now: 1_000 });
  expect(good?.USD).toBe(0.23);

  const failing: RateFetch = async () => {
    throw new Error("offline");
  };
  const stale = await getMyrRates({
    fetchImpl: failing,
    now: 1_000 + RATE_TTL_MS + 1,
  });

  expect(stale).toEqual(good);
});

test("a cold start with no network falls back to the indicative table", async () => {
  const rates = await getMyrRates({
    fetchImpl: async () => {
      throw new Error("offline");
    },
    now: 1_000,
  });

  expect(rates).toBeNull();
});

test("the page reads cached live rates and says which kind it used", () => {
  const page = readFileSync(new URL("../app/pay/page.tsx", import.meta.url), "utf8");

  expect(page).toContain("await getMyrRates()");
  expect(page).toContain("withLiveRate");
  expect(page).toContain("today's exchange rate");
  expect(page).toContain("an indicative rate");
});
