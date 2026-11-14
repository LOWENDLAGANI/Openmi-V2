import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { SandboxHandle } from "@/lib/execution/provider";

import {
  RUN_ARTIFACT_MAX_FILE_BYTES,
  RUN_ARTIFACT_MAX_FILES,
  RUN_DIFF_MAX_BYTES,
  RUN_READ_MAX_BYTES,
} from "./limits";
import { RUN_WORKDIR } from "./tools";

/**
 * Artifacts: the run's output, outside Postgres.
 *
 * A row says what exists — path, kind, size, hash — and the bytes go to an
 * object store. Two backends:
 *
 *   - `fs` (default): `RUN_ARTIFACT_DIR`, for a single-host deployment where
 *     the worker and the web server share a disk. Nothing is assumed: the
 *     directory is created on first write.
 *   - S3-compatible (`RUN_ARTIFACTS_BUCKET` + endpoint + keys), which is what
 *     a worker on its own machine needs, and what R2 is. Requests are signed
 *     with SigV4 here rather than by pulling in an SDK for two verbs.
 *
 * Neither backend is required to boot: a run with no store still reports its
 * diff in the event stream, and says the bytes were not kept.
 */

type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function s3Config(): S3Config | null {
  const bucket = process.env.RUN_ARTIFACTS_BUCKET?.trim() ?? "";
  const endpoint = process.env.RUN_ARTIFACTS_ENDPOINT?.trim() ?? "";
  const accessKeyId = process.env.RUN_ARTIFACTS_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = process.env.RUN_ARTIFACTS_SECRET_ACCESS_KEY?.trim() ?? "";

  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;

  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    bucket,
    region: process.env.RUN_ARTIFACTS_REGION?.trim() || "auto",
    accessKeyId,
    secretAccessKey,
  };
}

function localDir(): string {
  return resolve(process.env.RUN_ARTIFACT_DIR?.trim() || ".openmi-artifacts");
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A key that cannot escape the bucket prefix. */
function storageKey(runId: string, kind: string, path: string): string {
  const safe = path
    .split("/")
    .filter((part) => part.length > 0 && part !== "." && part !== "..")
    .join("/")
    .replace(/[^A-Za-z0-9._@+/-]/g, "_");

  return `${runId}/${kind}/${safe.length > 0 ? safe : "artifact"}`;
}

function objectUrl(config: S3Config, key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${config.endpoint}/${config.bucket}/${encoded}`;
}

const EMPTY_HASH = createHash("sha256").update("").digest("hex");

/**
 * SigV4 for a header-signed request.
 *
 * Deliberately minimal: no query signing, no chunked upload, no session token.
 * Those are not needed to PUT and GET one object, and a smaller surface is
 * easier to check than a vendored SDK.
 */
function signedHeaders(input: {
  config: S3Config;
  method: "GET" | "PUT";
  url: string;
  payload: Buffer | null;
}): Record<string, string> {
  const { config, method, url, payload } = input;
  const parsed = new URL(url);
  const payloadHash = payload ? sha256(payload) : EMPTY_HASH;

  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, "")
    .slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);

  const canonicalHeaders =
    `host:${parsed.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signed = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    method,
    parsed.pathname,
    "",
    canonicalHeaders,
    signed,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(Buffer.from(canonicalRequest, "utf8")),
  ].join("\n");

  const hmac = (key: Buffer | string, value: string) =>
    createHmac("sha256", key).update(value, "utf8").digest();

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region), "s3"),
    "aws4_request"
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return {
    host: parsed.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
  };
}

export type StoredArtifact = {
  storage_key: string;
  bytes: number;
  sha256: string;
};

export async function putArtifact(input: {
  runId: string;
  path: string;
  kind: "file" | "diff" | "log";
  body: Buffer;
}): Promise<StoredArtifact> {
  const key = storageKey(input.runId, input.kind, input.path);
  const config = s3Config();

  if (config) {
    const url = objectUrl(config, key);
    const headers = signedHeaders({
      config,
      method: "PUT",
      url,
      payload: input.body,
    });

    const response = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/octet-stream" },
      body: new Uint8Array(input.body),
    });

    if (!response.ok) {
      throw new Error(`Artifact upload failed with status ${response.status}.`);
    }
  } else {
    const target = join(localDir(), key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.body);
  }

  return { storage_key: key, bytes: input.body.byteLength, sha256: sha256(input.body) };
}

export async function readArtifact(
  storageKeyValue: string,
  maxBytes = RUN_DIFF_MAX_BYTES
): Promise<string | null> {
  const config = s3Config();

  try {
    if (config) {
      const url = objectUrl(config, storageKeyValue);
      const headers = signedHeaders({ config, method: "GET", url, payload: null });
      const response = await fetch(url, { headers, cache: "no-store" });

      if (!response.ok) return null;
      const text = await response.text();
      return text.slice(0, maxBytes);
    }

    const target = join(localDir(), storageKeyValue);
    const text = await readFile(target, "utf8");
    return text.slice(0, maxBytes);
  } catch {
    return null;
  }
}

export type CollectedArtifacts = {
  files: string[];
  uploaded: number;
  diffBytes: number;
  stat: string;
  diffKept: boolean;
};

function changedPaths(porcelain: string): string[] {
  const paths: string[] = [];

  for (const line of porcelain.split("\n")) {
    const trimmed = line.trimEnd();
    if (trimmed.length < 4) continue;

    const rest = trimmed.slice(3).trim();
    const target = rest.includes(" -> ") ? rest.split(" -> ")[1] : rest;

    if (target.length > 0 && !paths.includes(target)) paths.push(target);
  }

  return paths;
}

/**
 * Collects what a run changed.
 *
 * The workspace is a git checkout with one `base` commit, so the diff is
 * `git add -A` followed by `git diff --cached`. Nothing is pushed: this is the
 * record the reader reviews, not a write to GitHub.
 *
 * Caps are applied before the upload, not after: 40 files, 200 KB each and a
 * 400 KB diff, so one run cannot fill the bucket.
 */
export async function collectRunArtifacts(
  sandbox: SandboxHandle,
  runId: string
): Promise<CollectedArtifacts> {
  const status = await sandbox.exec(
    "git add -A && git status --porcelain",
    RUN_WORKDIR,
    60_000
  );

  const files = changedPaths(status.output).slice(0, RUN_ARTIFACT_MAX_FILES);

  const stat = await sandbox.exec(
    "git diff --cached --stat --no-color | head -c 4000",
    RUN_WORKDIR,
    60_000
  );

  const diff = await sandbox.exec(
    `git diff --cached --no-color | head -c ${RUN_DIFF_MAX_BYTES}`,
    RUN_WORKDIR,
    120_000
  );

  const diffBody = Buffer.from(diff.output, "utf8");
  let uploaded = 0;
  let diffKept = false;

  if (diffBody.byteLength > 0) {
    try {
      await putArtifact({ runId, path: "changes.diff", kind: "diff", body: diffBody });
      uploaded += 1;
      diffKept = true;
    } catch {
      // A store that is not configured is reported, not fatal: the run still
      // has its transcript and its summary.
    }
  }

  for (const path of files) {
    try {
      const text = await sandbox.readText(
        `${RUN_WORKDIR}/${path}`,
        Math.min(RUN_ARTIFACT_MAX_FILE_BYTES, RUN_READ_MAX_BYTES)
      );

      await putArtifact({
        runId,
        path,
        kind: "file",
        body: Buffer.from(text, "utf8"),
      });
      uploaded += 1;
    } catch {
      // A binary file, a deleted file and a store that refused all land here.
      // The path is still in the list, which is what the reader needs.
    }
  }

  return {
    files,
    uploaded,
    diffBytes: diffBody.byteLength,
    stat: stat.output.trim().split("\n").slice(-1)[0] ?? "",
    diffKept,
  };
}
