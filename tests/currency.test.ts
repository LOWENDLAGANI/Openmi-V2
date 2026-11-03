import { expect, test } from "bun:test";

import {
  COUNTRY_HEADER,
  DEFAULT_CURRENCY,
  countryFromHeaders,
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

test("the country comes only from the geo header", () => {
  const headers = new Headers({ [COUNTRY_HEADER]: "gb" });
  expect(countryFromHeaders(headers)).toBe("gb");
  expect(countryFromHeaders(new Headers())).toBeNull();
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
