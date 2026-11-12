import "server-only";

/**
 * The hosting provider, and nothing else.
 *
 * One module so a provider swap is one file, the same shape as the sandbox
 * provider. It returns the provider's own words — id, hostname, `readyState`,
 * error message — and decides nothing about what the product may claim. That
 * judgement lives in `plan.ts`, where it is tested without a network.
 */

export const VERCEL_API = "https://api.vercel.com";
export const VERCEL_TIMEOUT_MS = 20_000;

export type ProviderDeployment = {
  id: string;
  /** The provider's hostname, not a URL. */
  url: string | null;
  state: string;
  error: string | null;
};

export class PublishError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "PublishError";
    this.status = status;
  }
}

type Wire = {
  id?: string;
  url?: string | null;
  readyState?: string | null;
  errorMessage?: string | null;
};

function toDeployment(data: Wire): ProviderDeployment {
  if (!data.id) {
    throw new PublishError("The hosting provider returned no deployment id.");
  }

  return {
    id: String(data.id),
    url: data.url ? String(data.url) : null,
    state: data.readyState ? String(data.readyState) : "UNKNOWN",
    error: data.errorMessage ? String(data.errorMessage) : null,
  };
}

async function call<T>(
  token: string,
  teamId: string | null,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<T> {
  const url = new URL(`${VERCEL_API}${path}`);
  if (teamId && teamId.trim().length > 0) url.searchParams.set("teamId", teamId.trim());

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "openmi",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(VERCEL_TIMEOUT_MS),
    });
  } catch {
    throw new PublishError(
      "The hosting provider did not answer within 20 seconds. Nothing was published."
    );
  }

  if (response.ok) return (await response.json()) as T;

  // The provider's own message is the most useful sentence on the card, but it
  // is not trusted as HTML: it is a string that is rendered as text.
  const detail = (await response.json().catch(() => null)) as
    | { error?: { message?: string }; message?: string }
    | null;

  const message =
    detail?.error?.message ?? detail?.message ?? `The provider returned ${response.status}.`;

  throw new PublishError(message.slice(0, 400), response.status);
}

/** Creates a deployment from a GitHub commit. The provider builds it. */
export async function createDeployment(input: {
  token: string;
  teamId: string | null;
  name: string;
  repoId: number;
  ref: string;
  sha: string;
}): Promise<ProviderDeployment> {
  const data = await call<Wire>(input.token, input.teamId, "POST", "/v13/deployments", {
    name: input.name,
    // Production is the branch the chat is pinned to; a preview deployment of a
    // pull request is not what a Publish button means.
    target: "production",
    gitSource: {
      type: "github",
      repoId: input.repoId,
      ref: input.ref,
      sha: input.sha,
    },
  });

  return toDeployment(data);
}

/** Reads the state of a deployment that is still building. */
export async function readDeployment(input: {
  token: string;
  teamId: string | null;
  id: string;
}): Promise<ProviderDeployment> {
  const data = await call<Wire>(
    input.token,
    input.teamId,
    "GET",
    `/v13/deployments/${encodeURIComponent(input.id)}`
  );

  return toDeployment(data);
}
