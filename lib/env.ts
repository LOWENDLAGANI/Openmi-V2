/**
 * The environment contract.
 *
 * Two rules, both learned the hard way:
 *
 * 1. A missing key never throws at boot. The app has to start so that /setup
 *    can say *which* key is missing. A crash-on-boot turns a configuration
 *    problem into an outage with no message.
 * 2. Presence is reported, values are not. Everything here returns booleans and
 *    key names, so nothing secret can be rendered into a page or a log.
 *
 * This module is intentionally free of `next` imports so tests can read it
 * without a request context.
 */

export type EnvScope = "public" | "server";

export type EnvSpec = {
  key: string;
  scope: EnvScope;
  required: boolean;
  unlocks: string;
  hint: string;
};

/** Chat needs one of these. Any single provider is enough to answer. */
export const AI_PROVIDER_KEYS = [
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "DEEPSEEK_API_KEY",
] as const;

export const AI_PROVIDER_LABEL = "one AI provider key";

export const ENV_SPEC: EnvSpec[] = [
  {
    key: "NEXT_PUBLIC_SUPABASE_URL",
    scope: "public",
    required: true,
    unlocks: "Postgres and auth endpoint",
    hint: "Supabase → Project settings → API → Project URL",
  },
  {
    key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    scope: "public",
    required: true,
    unlocks: "Browser-safe database and auth calls",
    hint: "Supabase → Project settings → API → anon public key",
  },
  {
    key: "SUPABASE_SERVICE_ROLE_KEY",
    scope: "server",
    required: true,
    unlocks: "Migration status and health probes",
    hint: "Supabase → Project settings → API → service_role key (server only)",
  },
  {
    key: "NEXT_PUBLIC_SITE_URL",
    scope: "public",
    required: true,
    unlocks: "Auth redirects and pull-request links",
    hint: "http://localhost:3000 in development, your Vercel domain in production",
  },
  {
    key: "GITHUB_TOKEN_KEY",
    scope: "server",
    required: true,
    unlocks: "Sealing connected GitHub tokens",
    hint: "openssl rand -base64 32 — rotating it invalidates existing connections",
  },
  {
    key: "OPENROUTER_API_KEY",
    scope: "server",
    required: false,
    unlocks: "Auto mode, primary provider",
    hint: "At least one provider key is required",
  },
  {
    key: "GROQ_API_KEY",
    scope: "server",
    required: false,
    unlocks: "Code mode and the Auto fallback",
    hint: "At least one provider key is required",
  },
  {
    key: "DEEPSEEK_API_KEY",
    scope: "server",
    required: false,
    unlocks: "Flash mode",
    hint: "At least one provider key is required",
  },
  {
    key: "GITHUB_OAUTH_CLIENT_ID",
    scope: "server",
    required: false,
    unlocks: "OAuth connect flow (optional; a personal access token works without it)",
    hint: "GitHub → Developer settings → OAuth Apps",
  },
  {
    key: "GITHUB_OAUTH_CLIENT_SECRET",
    scope: "server",
    required: false,
    unlocks: "OAuth connect flow",
    hint: "GitHub → Developer settings → OAuth Apps",
  },
  {
    key: "ADMIN_EMAILS",
    scope: "server",
    required: false,
    unlocks: "The hidden admin panel, by exact email",
    hint: "Comma separated; ADMIN_EMAIL_DOMAIN covers a whole workspace",
  },
  {
    key: "ADMIN_EMAIL_DOMAIN",
    scope: "server",
    required: false,
    unlocks: "Admin panel for every account on one domain",
    hint: "@mycompany.com (the verified Google address must end with it)",
  },
  {
    key: "PAYMENT_LINK",
    scope: "server",
    required: false,
    unlocks: "The hosted payment button on /pay",
    hint: "Defaults to the Sociabuzz page in lib/billing/plans.ts",
  },
  {
    key: "UPSTASH_REDIS_REST_URL",
    scope: "server",
    required: false,
    unlocks: "Shared rate limiter (optional; Postgres is the fallback)",
    hint: "Upstash Redis REST endpoint",
  },
  {
    key: "UPSTASH_REDIS_REST_TOKEN",
    scope: "server",
    required: false,
    unlocks: "Shared rate limiter",
    hint: "Upstash Redis REST token",
  },
];

export type EnvStatus = EnvSpec & { present: boolean };

export type EnvReport = {
  statuses: EnvStatus[];
  /** Required keys that are absent, plus the provider group when empty. */
  missingRequired: string[];
  aiProviders: number;
  required: number;
  requiredPresent: number;
  ready: boolean;
};

function isPresent(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function readAiProviders(env: Record<string, string | undefined>): number {
  return AI_PROVIDER_KEYS.filter((key) => isPresent(env[key])).length;
}

/**
 * Reads presence only. Accepts an explicit env map so the setup page and the
 * tests can evaluate different configurations without touching `process.env`.
 */
export function readEnvReport(
  env: Record<string, string | undefined> = process.env
): EnvReport {
  const statuses: EnvStatus[] = ENV_SPEC.map((spec) => ({
    ...spec,
    present: isPresent(env[spec.key]),
  }));

  const requiredSpecs = statuses.filter((spec) => spec.required);
  const requiredPresent = requiredSpecs.filter((spec) => spec.present).length;
  const missingRequired = requiredSpecs
    .filter((spec) => !spec.present)
    .map((spec) => spec.key);

  const aiProviders = readAiProviders(env);
  if (aiProviders === 0) {
    missingRequired.push(
      `AI provider (${AI_PROVIDER_KEYS.join(" or ")})`
    );
  }

  return {
    statuses,
    missingRequired,
    aiProviders,
    required: requiredSpecs.length,
    requiredPresent,
    ready: missingRequired.length === 0,
  };
}

/** Typed access for server code. `null` means "not configured", never a throw. */
export function serverEnv() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? null,
    githubTokenKey: process.env.GITHUB_TOKEN_KEY ?? null,
  };
}
