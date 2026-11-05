import "server-only";

import { EXEC_MAX_TARBALL_BYTES } from "./commands";

/**
 * The repository, as one archive.
 *
 * This is the whole of "clone the user's repo": one authenticated GitHub GET for
 * the tree at the pinned commit, uploaded into the sandbox. The sandbox never
 * holds the token, never configures a remote and never authenticates, which is
 * why D6.3 can say "all of them" rather than "all except the push credential".
 *
 * The size is checked twice: against `content-length` before the body is read,
 * and against the buffer that actually arrived. A redirect to a large archive
 * cannot walk past the first check and then allocate freely.
 */
export type ArchiveFailure =
  | { ok: false; failure: "repo_too_large"; detail: string }
  | { ok: false; failure: "seed_failed"; detail: string };

export async function fetchRepoArchive(input: {
  token: string;
  repo: string;
  sha: string;
}): Promise<{ ok: true; bytes: Buffer; size: number } | ArchiveFailure> {
  const url = `https://api.github.com/repos/${input.repo}/tarball/${input.sha}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${input.token}`,
        "user-agent": "openmi",
      },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (caught) {
    return {
      ok: false,
      failure: "seed_failed",
      detail:
        caught instanceof Error
          ? `GitHub did not answer: ${caught.message}`
          : "GitHub did not answer.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      failure: "seed_failed",
      detail: `GitHub answered ${response.status} for the repository archive.`,
    };
  }

  const announced = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(announced) && announced > EXEC_MAX_TARBALL_BYTES) {
    return {
      ok: false,
      failure: "repo_too_large",
      detail: `${Math.round(announced / 1_000_000)} MB is over the ${
        EXEC_MAX_TARBALL_BYTES / 1_000_000
      } MB limit.`,
    };
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (caught) {
    return {
      ok: false,
      failure: "seed_failed",
      detail:
        caught instanceof Error
          ? `The archive could not be read: ${caught.message}`
          : "The archive could not be read.",
    };
  }

  if (bytes.byteLength > EXEC_MAX_TARBALL_BYTES) {
    return {
      ok: false,
      failure: "repo_too_large",
      detail: `${Math.round(bytes.byteLength / 1_000_000)} MB is over the ${
        EXEC_MAX_TARBALL_BYTES / 1_000_000
      } MB limit.`,
    };
  }

  return { ok: true, bytes, size: bytes.byteLength };
}
