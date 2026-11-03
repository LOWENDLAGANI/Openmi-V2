import { expect, test } from "bun:test";

import {
  COUNTRY_COOKIE,
  COUNTRY_HEADER,
  COUNTRY_HEADERS,
  DEFAULT_CURRENCY,
  countryFromHeaders,
  countryFromLanguage,
  countryFromRequest,
  currencyForCountry,
  formatMoney,
  isConverted,
} from "../lib/billing/currency";

test("a known country maps to its own currency", () => {
  expect(currencyForCountry("US").code).toBe("USD");
  expect(currencyForCountry("sg").code).toBe("SGD");
  expect(currencyForCountry(" IN ").code).toBe("INR");
  expect(currencyForCountry("DE").code).toBe("EUR");
  expect(currencyForCountry("MY").code).toBe("MYR");
});

test("unknown or malformed countries fall back to ringgit", () => {
  expect(currencyForCountry(null).code).toBe("MYR");
  expect(currencyForCountry(undefined).code).toBe("MYR");
  expect(currencyForCountry("").code).toBe("MYR");
  expect(currencyForCountry("ZZ").code).toBe("MYR");
  expect(currencyForCountry("USA").code).toBe("MYR");
  expect(currencyForCountry("<script>").code).toBe("MYR");
});

test("the country comes from the first usable geo header", () => {
  const headers = new Headers({ [COUNTRY_HEADER]: "gb" });
  expect(countryFromHeaders(headers)).toBe("GB");
  expect(countryFromHeaders(new Headers())).toBeNull();

  // Cloudflare and the generic header count too, and a placeholder is skipped.
  expect(countryFromHeaders(new Headers({ "cf-ipcountry": "de" }))).toBe("DE");
  expect(
    countryFromHeaders(
      new Headers({ "cf-ipcountry": "XX", "x-country-code": "in" })
    )
  ).toBe("IN");
  expect(
    countryFromHeaders(new Headers({ "x-vercel-ip-country": "T1" }))
  ).toBeNull();
  expect(COUNTRY_HEADERS[0]).toBe(COUNTRY_HEADER);
});

test("a language tag's region is the last resort", () => {
  expect(countryFromLanguage("en-GB,en;q=0.9")).toBe("GB");
  expect(countryFromLanguage("ms-MY")).toBe("MY");
  expect(countryFromLanguage("en")).toBeNull();
  expect(countryFromLanguage(null)).toBeNull();
});

test("a request falls back from geo to the hint cookie to language", () => {
  const geo = new Headers({ "cf-ipcountry": "SG" });
  expect(countryFromRequest(geo, "US")).toBe("SG");

  const none = new Headers({ "accept-language": "en-CA,en;q=0.8" });
  expect(countryFromRequest(none, "US")).toBe("US");
  expect(countryFromRequest(none, null)).toBe("CA");
  expect(COUNTRY_COOKIE).toBe("openmi-country");
});

test("formatting keeps the local symbol and drops noise digits", () => {
  const usd = currencyForCountry("US");
  const text = formatMoney(15, usd);
  expect(text).toContain("$");
  expect(text).toContain("3.3");
  expect(formatMoney(15, DEFAULT_CURRENCY)).toContain("RM");
});

test("a converted currency is marked and ringgit is not", () => {
  expect(isConverted(currencyForCountry("US"))).toBe(true);
  expect(isConverted(DEFAULT_CURRENCY)).toBe(false);
});

test("bad amounts never render as NaN", () => {
  expect(formatMoney(Number.NaN, DEFAULT_CURRENCY)).toBe("—");
  expect(formatMoney(-1, currencyForCountry("US"))).toBe("—");
  expect(formatMoney(0, currencyForCountry("US"))).toContain("0");
});
