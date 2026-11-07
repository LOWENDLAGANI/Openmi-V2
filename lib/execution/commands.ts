/**
 * What the sandbox may run.
 *
 * The rule this file exists to enforce: a model never supplies a shell string.
 * It names a step — `install`, `build`, `typecheck` — and the runner looks the
 * command up here. A repository that asks the agent to `curl … | sh` has
 * nothing to reach: the only strings that reach a shell are the ones below,
 * chosen from a lockfile and a `package.json` this process read itself.
 *
 * Caps live here rather than in a prompt for the same reason they live in
 * `lib/agent/tools.ts`: a model that ignores them gets a typed refusal, not a
 * silent truncation.
 */

export type ExecutionStep = "install" | "build" | "typecheck";

/** The order the runner uses, and the only names a tool may pass. */
export const EXEC_STEPS: readonly ExecutionStep[] = ["install", "build", "typecheck"];

/** One step's ceiling. A build that needs longer says so rather than hanging. */
export const EXEC_STEP_TIMEOUT_MS = 180_000;

/** Output kept per step, tail-first: the failure is at the end, not the start. */
export const EXEC_MAX_OUTPUT_BYTES = 65_536;

/** A repository larger than this is refused before a sandbox is created. */
export const EXEC_MAX_TARBALL_BYTES = 80_000_000;

/** Collected changes, before they become a changeset. */
export const EXEC_MAX_FILES = 40;
export const EXEC_MAX_PATCH_BYTES = 400_000;

/**
 * Absolute, because the file API writes as the sandbox user and its home is the
 * writable root. E2B runs as `user` with `/home/user` as both the home and the
 * default working directory, so the repository lives inside that home rather
 * than at `/workspace`, which the sandbox user cannot create.
 */
export const EXEC_WORKDIR = "/home/user/openmi-workspace";

/**
 * The template the runner asks for when none is configured.
 *
 * E2B's `base` image is the JavaScript-first default this file assumes: node,
 * npm and git are present, which is what the lockfile-driven installs below
 * need. A repository that needs bun or pnpm baked in wants a custom template
 * instead of an install at boot.
 */
export const DEFAULT_TEMPLATE = "base";

/**
 * The longest lifetime the provider accepts: 24 h, on an account with a card.
 * A chat's own deadline is 48 h and is enforced by the sweep; this is only the
 * ceiling handed to the sandbox itself.
 */
export const EXEC_MAX_TIMEOUT_SECONDS = 86_400;

/** What a key on the free plan accepts. One retry falls back to this. */
export const EXEC_FREE_TIER_TIMEOUT_SECONDS = 3_600;

/**
 * Hosts an install is allowed to reach. Deny-by-default: the provider enforces
 * this at the network layer, so a `postinstall` script cannot post a token
 * anywhere even though it runs as arbitrary code.
 *
 * Sent as E2B's `allowOut`, which must currently be paired with a matching
 * `denyOut: ["ALL_TRAFFIC"]` or the sandbox boot returns 400. For the project's
 * current E2B SDK version this is the only allowOut shape that starts the sandbox.
 */
export const EXEC_ALLOWED_DOMAINS: readonly string[] = ["ALL_TRAFFIC"];

export type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

export type DetectedCommands = {
  install: string | null;
  build: string | null;
  typecheck: string | null;
  /** Why a step is absent, phrased for a card rather than a log. */
  reason: string | null;
};

type PackageJson = {
  scripts?: Record<string, unknown>;
};

function readPackageJson(value: unknown): PackageJson | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as PackageJson;
}

function hasScript(pkg: PackageJson | null, name: string): boolean {
  const script = pkg?.scripts?.[name];
  return typeof script === "string" && script.trim().length > 0;
}

function packageManager(paths: readonly string[]): PackageManager | null {
  if (paths.includes("bun.lock") || paths.includes("bun.lockb")) return "bun";
  if (paths.includes("pnpm-lock.yaml")) return "pnpm";
  if (paths.includes("yarn.lock")) return "yarn";
  if (paths.includes("package-lock.json")) return "npm";
  return null;
}

function installFor(manager: PackageManager | null): string | null {
  if (manager === "bun") return "bun install --frozen-lockfile";
  if (manager === "pnpm") return "pnpm install --frozen-lockfile";
  if (manager === "yarn") return "yarn install --immutable";
  if (manager === "npm") return "npm ci --no-audit --no-fund";
  return null;
}

function scriptFor(manager: PackageManager, name: string): string {
  if (manager === "bun") return `bun run ${name}`;
  if (manager === "pnpm") return `pnpm run ${name}`;
  if (manager === "yarn") return `yarn ${name}`;
  return `npm run ${name}`;
}

/**
 * Reads a workspace and decides what can run in it.
 *
 * `paths` are repository-relative and already collected, so this is a pure
 * function of the tree and the parsed `package.json` — no filesystem, no
 * network, no model. A shape it does not recognise produces `reason`, and the
 * run is refused rather than guessed at.
 */
export function detectCommands(input: {
  paths: readonly string[];
  packageJson: unknown;
}): DetectedCommands {
  const paths = input.paths;
  const pkg = readPackageJson(input.packageJson);

  // JavaScript first: a repo with a package.json is a repo whose build is
  // described there, even if it also carries a Cargo.toml for a subpackage.
  if (pkg) {
    const manager = packageManager(paths);

    if (!manager) {
      return {
        install: null,
        build: hasScript(pkg, "build") ? null : null,
        typecheck: null,
        reason: "package.json has no lockfile, so an install would not be reproducible",
      };
    }

    const install = installFor(manager);
    const build = hasScript(pkg, "build") ? scriptFor(manager, "build") : null;
    const typecheck = hasScript(pkg, "typecheck") ? scriptFor(manager, "typecheck") : null;

    return {
      install,
      build,
      typecheck,
      reason: build ? null : "package.json has no build script",
    };
  }

  if (paths.includes("go.mod")) {
    return {
      install: "go mod download",
      build: "go build ./...",
      typecheck: null,
      reason: null,
    };
  }

  if (paths.includes("Cargo.toml")) {
    return {
      install: "cargo fetch",
      build: "cargo build",
      typecheck: null,
      reason: null,
    };
  }

  if (paths.includes("requirements.txt")) {
    return {
      install: "pip install -r requirements.txt",
      build: null,
      typecheck: null,
      reason: "there is no build step for a requirements.txt project",
    };
  }

  return {
    install: null,
    build: null,
    typecheck: null,
    reason: "this repository's shape is not one Openmi recognises",
  };
}

/** The command for one step, or null when the workspace cannot run it. */
export function commandFor(
  detected: DetectedCommands,
  step: ExecutionStep
): string | null {
  return detected[step];
}

/**
 * Keeps the last `EXEC_MAX_OUTPUT_BYTES`, cut on a line boundary when one is
 * nearby. A truncated tail is marked, so a card never implies it saw everything.
 */
export function tailOf(text: string, maxBytes: number = EXEC_MAX_OUTPUT_BYTES): {
  text: string;
  truncated: boolean;
} {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return { text, truncated: false };

  // Slice bytes, not code units, then drop a partial first line.
  const buffer = Buffer.from(text, "utf8");
  const tail = buffer.subarray(buffer.length - maxBytes).toString("utf8");
  const firstBreak = tail.indexOf("\n");
  const cleaned = firstBreak >= 0 && firstBreak < 200 ? tail.slice(firstBreak + 1) : tail;

  return { text: `… output truncated; showing the last ${maxBytes} bytes\n${cleaned}`, truncated: true };
}
