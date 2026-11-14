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
  "STRAITLY_API_KEY",
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
    unlocks: "Auto's UnoRouter model pool",
    hint: "At least one provider key is required",
  },
  {
    key: "STRAITLY_API_KEY",
    scope: "server",
    required: false,
    unlocks: "Primary provider for the named DeepSeek model (falls back to DeepSeek)",
    hint: "At least one provider key is required",
  },
  {
    key: "DEEPSEEK_API_KEY",
    scope: "server",
    required: false,
    unlocks: "Fallback provider for the named DeepSeek model",
    hint: "At least one provider key is required",
  },
  {
    key: "OPENROUTER_API_KEYS",
    scope: "server",
    required: false,
    unlocks: "Extra UnoRouter keys, tried before the first token",
    hint: "Comma or space separated; the primary key is always tried first",
  },
  {
    key: "STRAITLY_API_KEYS",
    scope: "server",
    required: false,
    unlocks: "Extra Straitly keys, tried before the first token",
    hint: "Comma or space separated; the primary key is always tried first",
  },
  {
    key: "DEEPSEEK_API_KEYS",
    scope: "server",
    required: false,
    unlocks: "Extra DeepSeek keys, tried before the first token",
    hint: "Comma or space separated; the primary key is always tried first",
  },
  {
    key: "GITHUB_OAUTH_CLIENT_ID",
    scope: "server",
    required: false,
    unlocks: "OAuth connect flow (optional; a personal access token works without it)",
    hint: "GitHub → Developer settings → OAuth Apps; callback is <site>/auth/github/callback",
  },
  {
    key: "GITHUB_OAUTH_CLIENT_SECRET",
    scope: "server",
    required: false,
    unlocks: "OAuth connect flow (server only; pairs with the client id)",
    hint: "The OAuth App's client secret — never a NEXT_PUBLIC_ value",
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
    key: "TOPUP_PAUSED",
    scope: "server",
    required: false,
    unlocks: "Open real-money checkout on /pay",
    hint: 'Open by default; set to "on" to pause the payment link and receipt form',
  },
  {
    key: "RESEND_API_KEY",
    scope: "server",
    required: false,
    unlocks: "Emails you the receipt when a member uploads one",
    hint: "resend.com → API keys; without it the upload still waits in /admin",
  },
  {
    key: "RECEIPT_NOTIFY_EMAIL",
    scope: "server",
    required: false,
    unlocks: "Which inbox receives uploaded receipts",
    hint: "Defaults to the first address in ADMIN_EMAILS",
  },
  {
    key: "RECEIPT_FROM_EMAIL",
    scope: "server",
    required: false,
    unlocks: "The sender line on receipt notifications",
    hint: "Defaults to the Resend test sender, which only reaches the account owner",
  },
  {
    key: "NEXT_PUBLIC_ADSTERRA_LEADERBOARD_KEY",
    scope: "public",
    required: false,
    unlocks: "Leaderboard banner on wide screens",
    hint: "Adsterra banner key; the slot renders a placeholder until it is set",
  },
  {
    key: "NEXT_PUBLIC_ADSTERRA_MOBILE_KEY",
    scope: "public",
    required: false,
    unlocks: "Compact banner on phones",
    hint: "Adsterra banner key for the 320×50 slot",
  },
  {
    key: "NEXT_PUBLIC_ADSTERRA_RECTANGLE_KEY",
    scope: "public",
    required: false,
    unlocks: "The 300×250 slot, when a page uses it",
    hint: "Adsterra banner key; optional, reserved for inline rectangles",
  },
  {
    key: "CUSTOM_MODELS",
    scope: "server",
    required: false,
    unlocks: "Model choices beyond the built-in catalogue",
    hint: 'JSON array: [{"id":"my-model","name":"My Model","provider":"openrouter","upstream":"vendor/model-id","category":"coding"}] (category optional)',
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
  {
    key: "E2B_API_KEY",
    scope: "server",
    required: false,
    unlocks: "Sandbox verification (install + build on a real Linux workspace)",
    hint: "E2B dashboard → API keys; runs stay off until this is set",
  },
  {
    key: "EXECUTION_ENABLED",
    scope: "server",
    required: false,
    unlocks: "A kill switch for sandbox runs",
    hint: 'Set to "off" to disable runs without removing the key',
  },
  {
    key: "EXECUTION_TEMPLATE",
    scope: "server",
    required: false,
    unlocks: "The sandbox image runs start from",
    hint: "Defaults to E2B's base template; a custom image with bun or pnpm baked in is set by its name or id",
  },
  {
    key: "EXEC_NETWORK_MODE",
    scope: "server",
    required: false,
    unlocks: "Sandbox egress: off, restricted (an enumerated allowlist) or open",
    hint: 'Defaults to "restricted"; "open" reaches any host, "off" cannot install anything',
  },
  {
    key: "EXEC_MISSION_MINUTES",
    scope: "server",
    required: false,
    unlocks: "How long one mission may run",
    hint: "Defaults to 20, clamped to 1..30; the Dew reserve is minutes × 0.05",
  },
  {
    key: "CHAT_SANDBOX_ENABLED",
    scope: "server",
    required: false,
    unlocks: "Chat-scoped sandboxes (set to \"off\" to fall back to one box per message)",
    hint: "Defaults to on; only takes effect when E2B_API_KEY is set",
  },
  {
    key: "CHAT_SANDBOX_IDLE_MINUTES",
    scope: "server",
    required: false,
    unlocks: "How long a chat's sandbox stays warm after the last activity",
    hint: "Defaults to 5, clamped to 1..60; stopped boxes keep their disk",
  },
  {
    key: "CHAT_SANDBOX_TTL_HOURS",
    scope: "server",
    required: false,
    unlocks: "How long an inactive chat keeps its sandbox",
    hint: "Defaults to 48, clamped to 1..168; then the container and disk are destroyed",
  },
  {
    key: "CHAT_SANDBOX_ARCHIVE_HOURS",
    scope: "server",
    required: false,
    unlocks: "Archive a stopped chat sandbox to free disk quota",
    hint: "Defaults to 0 (off); 24 is the sensible value when quota, not cost, is the limit",
  },
  {
    key: "CHAT_SANDBOX_MAX_PER_OWNER",
    scope: "server",
    required: false,
    unlocks: "How many chat sandboxes one account may keep",
    hint: "Defaults to 3, clamped to 1..10; the least-recently-active is evicted first",
  },
  {
    key: "OPENMI_PREVIEW",
    scope: "server",
    required: false,
    unlocks: "The live preview panel in a chat (set to \"off\" to remove it)",
    hint: 'On only when E2B_API_KEY is set; "off" makes the preview routes 404',
  },
  {
    key: "OPENMI_CHECKPOINTS",
    scope: "server",
    required: false,
    unlocks: "Versions of a chat workspace, restorable inside the sandbox",
    hint: 'On only when E2B_API_KEY is set; "off" hides the versions panel',
  },
  {
    key: "VERCEL_TOKEN",
    scope: "server",
    required: false,
    unlocks: "Publishing a chat's app to the hosting provider",
    hint: "Vercel → Account settings → Tokens; without it Publish is unavailable",
  },
  {
    key: "VERCEL_TEAM_ID",
    scope: "server",
    required: false,
    unlocks: "Deploying under a Vercel team instead of a personal account",
    hint: "Vercel → Team settings → General → Team ID (optional)",
  },
  {
    key: "OPENMI_AUTO_WRITE",
    scope: "server",
    required: false,
    unlocks:
      "Writing a ready diff to its own branch and pull request without an approval click",
    hint: 'Defaults to on; set to "off" to require the click on the review card',
  },
  {
    key: "OPENMI_SANDBOX_TURNS",
    scope: "server",
    required: false,
    unlocks: "A chat turn that may open the Linux sandbox instead of GitHub only",
    hint: 'On by default; set to "off" for GitHub-only turns that never provision a box',
  },
  {
    key: "OPENMI_ALLOW_DEFAULT_BRANCH",
    scope: "server",
    required: false,
    unlocks:
      "Default-branch writes that nobody asked for by name (normally the reader naming a branch is enough)",
    hint: 'Off by default; a user who asks for a branch in the chat or names one on the card already authorizes it',
  },
  {
    key: "CRON_SECRET",
    scope: "server",
    required: false,
    unlocks:
      "The chat sandbox sweep (idle stops and the TTL wipe) and the run reconciliation route",
    hint: "Without it the sweep returns 503 and the provider timers are the only backstop",
  },
  {
    key: "RUN_MAX_MINUTES",
    scope: "server",
    required: false,
    unlocks: "How long one web-agent run may execute",
    hint: "Defaults to 15, clamped to 1..30; the loop and the sandbox share the ceiling",
  },
  {
    key: "RUN_WORKER_CONCURRENCY",
    scope: "server",
    required: false,
    unlocks: "How many runs one worker process executes at once",
    hint: "Defaults to 2, clamped to 1..8; per-account concurrency is a separate limit of 1",
  },
  {
    key: "RUN_ARTIFACT_DIR",
    scope: "server",
    required: false,
    unlocks: "Artifacts on the worker's own disk (single-host deployments)",
    hint: "Defaults to .openmi-artifacts; a worker on another machine needs the bucket instead",
  },
  {
    key: "RUN_ARTIFACTS_BUCKET",
    scope: "server",
    required: false,
    unlocks: "Artifacts in an S3-compatible bucket (R2, S3, MinIO)",
    hint: "Pairs with the endpoint and the two keys below; without all four, the local directory is used",
  },
  {
    key: "RUN_ARTIFACTS_ENDPOINT",
    scope: "server",
    required: false,
    unlocks: "The S3-compatible endpoint for artifacts",
    hint: "e.g. https://<account>.r2.cloudflarestorage.com — no bucket name in the path",
  },
  {
    key: "RUN_ARTIFACTS_REGION",
    scope: "server",
    required: false,
    unlocks: "The SigV4 region for artifact requests",
    hint: 'Defaults to "auto", which is what R2 expects',
  },
  {
    key: "RUN_ARTIFACTS_ACCESS_KEY_ID",
    scope: "server",
    required: false,
    unlocks: "Signing artifact uploads (server only)",
    hint: "An object-storage key, never a NEXT_PUBLIC_ value",
  },
  {
    key: "RUN_ARTIFACTS_SECRET_ACCESS_KEY",
    scope: "server",
    required: false,
    unlocks: "Signing artifact uploads (server only)",
    hint: "The secret paired with the key id; rotating it only affects new artifacts",
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

/**
 * Whether this deployment can start a sandbox.
 *
 * Presence plus kill switch, in one pure place: the runner, the setup probe and
 * the chat prompt have to answer "is execution on" identically, and the chat
 * prompt must not import the sandbox SDK to find out.
 */
export function executionConfigured(
  env: Record<string, string | undefined> = process.env
): boolean {
  const key = (env.E2B_API_KEY ?? "").trim();
  if (key.length === 0) return false;

  const flag = (env.EXECUTION_ENABLED ?? "on").trim().toLowerCase();
  return flag !== "off" && flag !== "false" && flag !== "0";
}

/**
 * Whether a chat turn may open the Linux sandbox.
 *
 * On by default: a turn gets the persistent workspace, so the agent can run what
 * it writes, and the files it changed are still there on the next message. The
 * handle is lazy, so a turn that never calls a tool provisions nothing.
 * `OPENMI_SANDBOX_TURNS=off` restores GitHub-only turns — reads plus a proposed
 * diff, no box, no shell, no browser.
 *
 * Separate from `executionConfigured()`: verification runs and missions keep
 * their sandboxes either way. This decides the chat turn only, and an empty
 * value means the default rather than "off" — a blank line in an env file is not
 * an instruction.
 */
export function sandboxTurnsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const flag = (env.OPENMI_SANDBOX_TURNS ?? "on").trim().toLowerCase();
  return flag !== "off" && flag !== "false" && flag !== "0" && flag !== "no";
}

/** Typed access for server code. `null` means "not configured", never a throw. */
export function serverEnv() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? null,
    githubTokenKey: process.env.GITHUB_TOKEN_KEY ?? null,
    githubOauthClientId: process.env.GITHUB_OAUTH_CLIENT_ID ?? null,
    githubOauthClientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET ?? null,
    e2bApiKey: process.env.E2B_API_KEY ?? null,
    executionEnabled: process.env.EXECUTION_ENABLED ?? null,
    executionTemplate: process.env.EXECUTION_TEMPLATE ?? null,
    executionNetworkMode: process.env.EXEC_NETWORK_MODE ?? null,
    execMissionMinutes: process.env.EXEC_MISSION_MINUTES ?? null,
    chatSandboxEnabled: process.env.CHAT_SANDBOX_ENABLED ?? null,
    chatSandboxIdleMinutes: process.env.CHAT_SANDBOX_IDLE_MINUTES ?? null,
    chatSandboxTtlHours: process.env.CHAT_SANDBOX_TTL_HOURS ?? null,
    chatSandboxArchiveHours: process.env.CHAT_SANDBOX_ARCHIVE_HOURS ?? null,
    chatSandboxMaxPerOwner: process.env.CHAT_SANDBOX_MAX_PER_OWNER ?? null,
    preview: process.env.OPENMI_PREVIEW ?? null,
    checkpoints: process.env.OPENMI_CHECKPOINTS ?? null,
    vercelToken: process.env.VERCEL_TOKEN ?? null,
    vercelTeamId: process.env.VERCEL_TEAM_ID ?? null,
    cronSecret: process.env.CRON_SECRET ?? null,
  };
}
