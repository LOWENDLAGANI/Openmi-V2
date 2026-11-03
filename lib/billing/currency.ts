// Display currency for the donation page.
//
// Money is charged by the hosted payment page in Malaysian ringgit, so every
// amount here is an *estimate* converted from RM for the visitor's country.
// Each currency carries a hand-written indicative rate that `withLiveRate`
// (lib/billing/rates.ts) replaces with a cached live rate when one is
// available: this module never charges, settles or stores an amount, and
// nothing downstream treats the converted figure as money owed.

export type Currency = {
  /** ISO 4217 code, e.g. "USD". */
  code: string;
  /** BCP 47 locale used only to group digits and place the symbol. */
  locale: string;
  /**
   * Units of this currency per 1 MYR: the live rate when the server has one,
   * otherwise the hand-written fallback below.
   */
  perMyr: number;
  /** English name, used in the "estimated" note. */
  name: string;
};

const CURRENCY = {
  MYR: { code: "MYR", locale: "en-MY", perMyr: 1, name: "Malaysian ringgit" },
  SGD: { code: "SGD", locale: "en-SG", perMyr: 0.3, name: "Singapore dollar" },
  USD: { code: "USD", locale: "en-US", perMyr: 0.22, name: "US dollar" },
  GBP: { code: "GBP", locale: "en-GB", perMyr: 0.17, name: "British pound" },
  EUR: { code: "EUR", locale: "de-DE", perMyr: 0.2, name: "euro" },
  AUD: { code: "AUD", locale: "en-AU", perMyr: 0.34, name: "Australian dollar" },
  CAD: { code: "CAD", locale: "en-CA", perMyr: 0.3, name: "Canadian dollar" },
  INR: { code: "INR", locale: "en-IN", perMyr: 18.5, name: "Indian rupee" },
  IDR: { code: "IDR", locale: "id-ID", perMyr: 3500, name: "Indonesian rupiah" },
  PHP: { code: "PHP", locale: "en-PH", perMyr: 12.8, name: "Philippine peso" },
  THB: { code: "THB", locale: "th-TH", perMyr: 7.6, name: "Thai baht" },
  VND: { code: "VND", locale: "vi-VN", perMyr: 5600, name: "Vietnamese dong" },
  JPY: { code: "JPY", locale: "ja-JP", perMyr: 33, name: "Japanese yen" },
  CNY: { code: "CNY", locale: "zh-CN", perMyr: 1.6, name: "Chinese yuan" },
  KRW: { code: "KRW", locale: "ko-KR", perMyr: 300, name: "South Korean won" },
  HKD: { code: "HKD", locale: "en-HK", perMyr: 1.7, name: "Hong Kong dollar" },
  TWD: { code: "TWD", locale: "zh-TW", perMyr: 7.1, name: "New Taiwan dollar" },
  AED: { code: "AED", locale: "en-AE", perMyr: 0.8, name: "UAE dirham" },
  SAR: { code: "SAR", locale: "ar-SA", perMyr: 0.82, name: "Saudi riyal" },
  NZD: { code: "NZD", locale: "en-NZ", perMyr: 0.37, name: "New Zealand dollar" },
  BDT: { code: "BDT", locale: "bn-BD", perMyr: 26, name: "Bangladeshi taka" },
  PKR: { code: "PKR", locale: "en-PK", perMyr: 61, name: "Pakistani rupee" },
  LKR: { code: "LKR", locale: "si-LK", perMyr: 66, name: "Sri Lankan rupee" },
  NGN: { code: "NGN", locale: "en-NG", perMyr: 340, name: "Nigerian naira" },
  ZAR: { code: "ZAR", locale: "en-ZA", perMyr: 4, name: "South African rand" },
  BRL: { code: "BRL", locale: "pt-BR", perMyr: 1.2, name: "Brazilian real" },
  MXN: { code: "MXN", locale: "es-MX", perMyr: 4.1, name: "Mexican peso" },
  TRY: { code: "TRY", locale: "tr-TR", perMyr: 7.6, name: "Turkish lira" },
  EGP: { code: "EGP", locale: "ar-EG", perMyr: 10.8, name: "Egyptian pound" },
} as const satisfies Record<string, Currency>;

export type CurrencyCode = keyof typeof CURRENCY;

/** Every code the page can display, in catalogue order. */
export const CURRENCY_CODES = Object.keys(CURRENCY) as CurrencyCode[];

/** The payment page always charges in ringgit, so that is the fallback. */
export const DEFAULT_CURRENCY: Currency = CURRENCY.MYR;

/**
 * Where a host puts the two-letter country. Vercel first, then Cloudflare and
 * the generic proxies, so the same deployment detects a visitor on more than one
 * platform. `COUNTRY_HEADER` is kept as the primary name for callers that only
 * want one.
 */
export const COUNTRY_HEADERS = [
  "x-vercel-ip-country",
  "cf-ipcountry",
  "x-country-code",
  "x-geo-country",
  "x-appengine-country",
] as const;

export const COUNTRY_HEADER = COUNTRY_HEADERS[0];

/**
 * The visitor's own browser region, written by `CountryHint` only when the
 * server could not detect a country from the request. It is a fallback, not an
 * override: a geo header always wins.
 */
export const COUNTRY_COOKIE = "openmi-country";

const COUNTRY_CURRENCY: Record<string, CurrencyCode> = {
  MY: "MYR",
  SG: "SGD",
  US: "USD",
  GB: "GBP",
  IE: "EUR",
  DE: "EUR",
  FR: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
  BE: "EUR",
  AT: "EUR",
  PT: "EUR",
  FI: "EUR",
  GR: "EUR",
  AU: "AUD",
  CA: "CAD",
  IN: "INR",
  ID: "IDR",
  PH: "PHP",
  TH: "THB",
  VN: "VND",
  JP: "JPY",
  CN: "CNY",
  HK: "HKD",
  TW: "TWD",
  KR: "KRW",
  AE: "AED",
  SA: "SAR",
  NZ: "NZD",
  BD: "BDT",
  PK: "PKR",
  LK: "LKR",
  NG: "NGN",
  ZA: "ZAR",
  BR: "BRL",
  MX: "MXN",
  TR: "TRY",
  EG: "EGP",
};

/**
 * The display currency for a country code. Unknown, missing or malformed
 * countries fall back to ringgit rather than guessing.
 */
export function currencyForCountry(country: string | null | undefined): Currency {
  if (!country) return DEFAULT_CURRENCY;
  const key = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(key)) return DEFAULT_CURRENCY;
  const code = COUNTRY_CURRENCY[key];
  return code ? CURRENCY[code] : DEFAULT_CURRENCY;
}

/**
 * Reads the country from the first header that carries a plausible code.
 * `XX` and `T1` are placeholder values (unknown, Tor) and are skipped rather
 * than mapped to a currency.
 */
export function countryFromHeaders(headers: {
  get(name: string): string | null;
}): string | null {
  for (const name of COUNTRY_HEADERS) {
    const code = (headers.get(name) ?? "").trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code) && code !== "XX" && code !== "T1") return code;
  }

  return null;
}

/**
 * The region out of the first `Accept-Language` tag: `en-GB,en;q=0.9` becomes
 * `GB`. A language without a region (plain `en`) says nothing about money and is
 * skipped.
 */
export function countryFromLanguage(header: string | null): string | null {
  if (!header) return null;

  for (const entry of header.split(",")) {
    const tag = entry.trim().split(";")[0]?.trim() ?? "";
    const parts = tag.split("-");
    if (parts.length < 2) continue;

    const region = parts[parts.length - 1] ?? "";
    if (/^[A-Za-z]{2}$/.test(region)) return region.toUpperCase();
  }

  return null;
}

/**
 * The country for a request: the host's geo header, then the browser region the
 * hint cookie remembered, then the request's own language tag. A deployment with
 * none of the three shows ringgit rather than guessing.
 */
export function countryFromRequest(
  headers: { get(name: string): string | null },
  cookieCountry?: string | null
): string | null {
  const geo = countryFromHeaders(headers);
  if (geo) return geo;

  const saved = (cookieCountry ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(saved)) return saved;

  return countryFromLanguage(headers.get("accept-language"));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Converts an RM amount for display and formats it for the currency's locale.
 * The amount converted is an estimate; callers must show the RM charge
 * alongside it.
 */
export function formatMoney(amountMyr: number, currency: Currency): string {
  if (!Number.isFinite(amountMyr) || amountMyr < 0) return "—";
  const value = round(amountMyr * currency.perMyr);
  const fractionDigits = value < 100 ? 2 : 0;

  try {
    return new Intl.NumberFormat(currency.locale, {
      style: "currency",
      currency: currency.code,
      minimumFractionDigits: 0,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  } catch {
    return `${currency.code} ${value.toFixed(fractionDigits)}`;
  }
}

/** True when the local currency differs from the ringgit actually charged. */
export function isConverted(currency: Currency): boolean {
  return currency.code !== DEFAULT_CURRENCY.code;
}
