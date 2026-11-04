import "server-only";

import { randomUUID } from "node:crypto";

import { safeRepoPath } from "@/lib/changesets";
import {
  changesetContentHash,
  changesetDisplayStatus,
  signChangeset,
  type ChangesetStatus,
} from "@/lib/changesets";
import { approveChangesetAndOpenPullRequest } from "@/lib/changesets/commit";
import { unifiedDiff } from "@/lib/diff";
import { getFile, getTree } from "@/lib/github/read";
import type { ModelId } from "@/lib/models";
import type { supabaseAdmin } from "@/lib/supabase/admin";
import type { supabaseServer } from "@/lib/supabase/server";

import { fetchRepoArchive } from "./archive";
import {
  EXEC_STEP_TIMEOUT_MS,
  EXEC_WORKDIR,
  detectCommands,
  type DetectedCommands,
} from "./commands";
import { reserveExecutionDew, settleExecutionDew } from "@/lib/dew/store";

import { EXEC_MAX_MINUTES, EXEC_RESERVE_DEW, chargeForDuration } from "./cost";
import { MAX_REPAIR_PASSES, requestRepair } from "./repair";
import { createSandbox, SandboxStartError, type SandboxHandle } from "./provider";
import { appendEvent, clearStaleRuns, createRun, updateRun } from "./store";
import type { ExecutionStage, FailureCode } from "./status";

/**
 * One run, start to finish.
 *
 * The order is the contract: the changeset is proven ready and owner-scoped,
 * the archive is size-checked, the sandbox starts, the tree is seeded, the
 * accepted files are written, and only then does anything execute. Each stage
 * is written to the row before the work starts, so a card can say where a run
 * stopped instead of waiting on a promise that no longer exists.
 *
 * The sandbox never receives a credential and never pushes. What lands on
 * GitHub still goes through approval, on an `openmi/agent/` branch.
 */

type SessionClient = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;
type AdminClient = NonNullable<ReturnType<typeof supabaseAdmin>>;

/**
 * Structurally the same as `ProposedFile` in `lib/github/write.ts`, declared
 * here rather than imported: the write client is allowed exactly one importer
 * (the approval path), and a type import still counts as a line of source that
 * names the module.
 */
type ProposedFile = { path: string; content: string };

export type RunContext = {
  chatId: string;
  changesetId: string;
  repo: string;
  baseSha: string;
  /** The chat's model, used only for a repair pass. */
  model: string;
  files: ProposedFile[];
};

export type StartRunResult =
  | { ok: true; runId: string; context: RunContext }
  | { ok: false; status: number; code: string; message: string };

type ChangesetRow = {
  id: string;
  status: string;
  chat_id: string;
  repo_full_name: string;
  base_sha: string;
  expires_at: string;
};

/**
 * Proves the request may run and records the run row. No sandbox exists yet:
 * this returns before any provider call so the browser has an id to poll.
 */
export async function startExecutionRun(input: {
  supabase: SessionClient;
  admin: AdminClient;
  owner: string;
  changesetId: string;
}): Promise<StartRunResult> {
  const { supabase, admin, owner, changesetId } = input;

  const { data: changesetResult, error: changesetError } = await supabase
    .from("changesets")
    .select("id, status, chat_id, repo_full_name, base_sha, expires_at")
    .eq("id", changesetId)
    .maybeSingle();

  if (changesetError) {
    return { ok: false, status: 400, code: "refused", message: changesetError.message };
  }

  if (!changesetResult) {
    return {
      ok: false,
      status: 404,
      code: "changeset_not_ready",
      message: "That changeset no longer exists.",
    };
  }

  const changeset = changesetResult as ChangesetRow;
  const displayStatus = changesetDisplayStatus({
    status: changeset.status as ChangesetStatus,
    expires_at: changeset.expires_at,
  });

  if (displayStatus !== "ready") {
    return {
      ok: false,
      status: 409,
      code: "changeset_not_ready",
      message: `That changeset is ${displayStatus}. Only a signed, ready changeset can be verified.`,
    };
  }

  const { data: fileRows } = await supabase
    .from("changeset_files")
    .select("path, proposed_content, error, accepted")
    .eq("changeset_id", changesetId)
    .eq("accepted", true);

  const files: ProposedFile[] = ((fileRows ?? []) as Array<{
    path: string;
    proposed_content: string;
    error: string | null;
    accepted: boolean;
  }>)
    .filter((file) => file.error === null && file.accepted)
    .map((file) => ({ path: String(file.path), content: String(file.proposed_content) }))
    .filter((file) => safeRepoPath(file.path) !== null);

  if (files.length === 0) {
    return {
      ok: false,
      status: 409,
      code: "changeset_not_ready",
      message: "No files are accepted, so there is nothing to verify.",
    };
  }

  const { data: chatRow } = await supabase
    .from("chats")
    .select("model")
    .eq("id", changeset.chat_id)
    .maybeSingle();

  const model =
    typeof (chatRow as { model?: unknown } | null)?.model === "string"
      ? String((chatRow as { model: string }).model)
      : "auto";

  // A unique index allows one live run per account. Clearing a stale row first
  // is what keeps a crashed run from locking the account out forever.
  await clearStaleRuns(admin, owner);

  // The id exists before the row, because the ledger references it. Reserve
  // first, then record: a run that cannot be paid for never leaves a row that
  // looks like it started.
  const runId = randomUUID();

  const reserved = await reserveExecutionDew(admin, owner, runId, EXEC_RESERVE_DEW);

  if (!reserved.ok) {
    return {
      ok: false,
      status: 402,
      code: "insufficient_dew",
      message: reserved.error.includes("insufficient balance")
        ? `A sandbox run reserves ${EXEC_RESERVE_DEW} Dew before it starts, and the balance cannot cover that. Top up with a code, or wait for the daily refill.`
        : `Dew could not be reserved, so nothing was started: ${reserved.error}`,
    };
  }

  try {
    await createRun(admin, {
      id: runId,
      owner,
      chatId: changeset.chat_id,
      changesetId,
      repo: changeset.repo_full_name,
      baseSha: changeset.base_sha,
      reservedDew: EXEC_RESERVE_DEW,
    });
  } catch (caught) {
    // The reservation exists but the run does not, so give it straight back.
    await settleExecutionDew(admin, owner, runId, 0);

    return {
      ok: false,
      status: 409,
      code: "refused",
      message:
        caught instanceof Error
          ? caught.message
          : "A run is already in progress for this account.",
    };
  }

  return {
    ok: true,
    runId,
    context: {
      chatId: changeset.chat_id,
      changesetId,
      repo: changeset.repo_full_name,
      baseSha: changeset.base_sha,
      model,
      files,
    },
  };
}

/**
 * The work behind one run. Called after the response is sent, so the browser
 * gets a run id immediately and polls the row rather than holding a request
 * open for a build.
 */
export async function executeRun(input: {
  admin: AdminClient;
  /** The request's own client, used only for the automatic approval. */
  supabase: SessionClient;
  owner: string;
  runId: string;
  token: string;
  context: RunContext;
  /** Let the model repair a failing build, up to MAX_REPAIR_PASSES. */
  repair?: boolean;
  /** Open the pull request when the build really exits 0. */
  autoApprove?: boolean;
  sealKey?: string | null;
}): Promise<void> {
  const startedAt = Date.now();
  let seq = 0;
  let sandbox: SandboxHandle | null = null;

  const event = async (
    kind: "status" | "step" | "output" | "observation",
    body: string
  ): Promise<void> => {
    seq += 1;
    await appendEvent(input.admin, {
      runId: input.runId,
      owner: input.owner,
      seq,
      kind,
      body,
    });
  };

  const stage = async (next: ExecutionStage): Promise<void> => {
    await updateRun(input.admin, input.runId, { status: "running", stage: next });
    await event("status", next);
  };

  const finish = async (patch: {
    status: "done" | "failed" | "timed_out" | "cancelled";
    failure_code?: FailureCode | null;
    failure_detail?: string | null;
    exit_code?: number | null;
  }): Promise<void> => {
    // `onlyWhileLive` is what keeps a cancelled run cancelled: the runner still
    // settles what it used, but it cannot turn "you cancelled this" into "done".
    await updateRun(
      input.admin,
      input.runId,
      {
        ...patch,
        failure_code: patch.failure_code ?? null,
        duration_ms: Date.now() - startedAt,
        ended_at: new Date().toISOString(),
      },
      { onlyWhileLive: true }
    );
  };

  try {
    const archive = await fetchRepoArchive({
      token: input.token,
      repo: input.context.repo,
      sha: input.context.baseSha,
    });

    if (!archive.ok) {
      await finish({
        status: "failed",
        failure_code: archive.failure,
        failure_detail: archive.detail,
      });
      return;
    }

    await event("observation", `repository archive: ${archive.size} bytes`);

    await stage("provision");
    try {
      sandbox = await createSandbox(input.runId);
    } catch (caught) {
      const failure =
        caught instanceof SandboxStartError ? caught.failure : ("refused" as const);

      await finish({
        status: "failed",
        failure_code: failure,
        failure_detail:
          caught instanceof Error ? caught.message : "The sandbox could not be started.",
      });
      return;
    }

    await updateRun(input.admin, input.runId, { sandbox_id: sandbox.id });
    await event("observation", `sandbox ${sandbox.id} started`);

    await stage("seed");
    const prepared = await seed(sandbox, archive.bytes, event);
    if (!prepared.ok) {
      await finish({
        status: "failed",
        failure_code: "seed_failed",
        failure_detail: prepared.detail,
      });
      return;
    }

    const detected = await detect(input.context.repo, input.context.baseSha, input.token);
    if (!detected) {
      await finish({
        status: "failed",
        failure_code: "no_build_command",
        failure_detail: "This repository's shape is not one Openmi recognises.",
      });
      return;
    }

    await updateRun(input.admin, input.runId, {
      install_command: detected.install,
      build_command: detected.build,
    });

    await stage("apply");
    const applied = await applyFiles(
      sandbox,
      input.context.files,
      input.context.repo,
      event
    );
    if (!applied.ok) {
      await finish({
        status: "failed",
        failure_code: "apply_failed",
        failure_detail: applied.detail,
      });
      return;
    }

    if (detected.install) {
      await stage("install");
      const result = await sandbox.exec(detected.install, EXEC_WORKDIR);
      await event("step", `${detected.install} → exit ${result.exitCode}`);
      await event("output", result.output || "(no output)");

      if (result.exitCode !== 0) {
        await finish({
          status: "failed",
          failure_code: "install_failed",
          failure_detail: `\`${detected.install}\` exited ${result.exitCode}.`,
          exit_code: result.exitCode,
        });
        return;
      }
    }

    if (Date.now() - startedAt > EXEC_MAX_MINUTES * 60_000) {
      await finish({ status: "timed_out" });
      return;
    }

    const buildCommand = detected.build;

    if (buildCommand) {
      const runBuild = async () => {
        await stage("build");
        // The cast is for the closure boundary: `sandbox` is assigned in the
        // `provision` stage above and every failure path there returns.
        const result = await (sandbox as SandboxHandle).exec(buildCommand, EXEC_WORKDIR);
        await event("step", `${buildCommand} → exit ${result.exitCode}`);
        await event("output", result.output || "(no output)");
        return result;
      };

      let result = await runBuild();
      let repairs = 0;

      // The autonomy loop: build, show the model the failure, rebuild. Bounded
      // twice — two passes, and the run's own wall-clock cap — because a model
      // that has not fixed a compile error twice is not going to on the fifth.
      while (
        result.exitCode !== 0 &&
        input.repair &&
        repairs < MAX_REPAIR_PASSES &&
        Date.now() - startedAt < EXEC_MAX_MINUTES * 60_000
      ) {
        repairs += 1;
        await event("observation", `repair pass ${repairs} after exit ${result.exitCode}`);

        const repaired = await repairOnce({
          // Narrowed by the successful `createSandbox` above; the cast is for
          // the closure boundary, not a claim that it could still be null.
          sandbox: sandbox as SandboxHandle,
          admin: input.admin,
          owner: input.owner,
          model: input.context.model,
          repo: input.context.repo,
          changesetId: input.context.changesetId,
          command: buildCommand,
          exitCode: result.exitCode,
          output: result.output,
          paths: input.context.files.map((file) => file.path),
          attempt: repairs,
          signal: AbortSignal.timeout(EXEC_STEP_TIMEOUT_MS * 2),
          event,
        });

        if (!repaired.ok) {
          await event(
            "observation",
            `repair ${repairs} produced nothing usable: ${repaired.error}`
          );
          break;
        }

        result = await runBuild();
      }

      if (result.exitCode !== 0) {
        await finish({
          status: "failed",
          failure_code: "build_failed",
          failure_detail: `\`${buildCommand}\` exited ${result.exitCode}${
            repairs > 0 ? ` after ${repairs} repair pass(es)` : ""
          }.`,
          exit_code: result.exitCode,
        });
        return;
      }

      if (input.autoApprove) {
        await autoApproveRun({
          supabase: input.supabase,
          admin: input.admin,
          owner: input.owner,
          context: input.context,
          sealKey: input.sealKey ?? null,
          event,
        });
      }

      await finish({ status: "done", exit_code: 0 });
      return;
    }

    await finish({
      status: "failed",
      failure_code: "no_build_command",
      failure_detail: detected.reason ?? "There is no build step to run.",
    });
  } catch (caught) {
    await finish({
      status: "failed",
      failure_code: "refused",
      failure_detail:
        caught instanceof Error ? caught.message : "The run failed unexpectedly.",
    });
  } finally {
    // Billing runs in `finally` on purpose: every exit path — success, refusal,
    // timeout, cancellation, a thrown provider error — settles the reservation
    // against the minutes actually used. A run that never got a sandbox is
    // refunded in full, because nothing ran.
    const charged = sandbox ? chargeForDuration(Date.now() - startedAt) : 0;
    const settled = await settleExecutionDew(
      input.admin,
      input.owner,
      input.runId,
      charged
    );

    if (settled.ok) {
      await updateRun(input.admin, input.runId, { charged_dew: charged });
    } else {
      await event("observation", `the reservation could not be settled: ${settled.error}`);
    }

    if (sandbox) await sandbox.destroy();
  }
}

async function seed(
  sandbox: SandboxHandle,
  bytes: Buffer,
  event: (kind: "status" | "step" | "output" | "observation", body: string) => Promise<void>
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const prepared = await sandbox.exec(`mkdir -p ${EXEC_WORKDIR}`, ".");

  if (prepared.exitCode !== 0) {
    return { ok: false, detail: `The workspace could not be created: ${prepared.output}` };
  }

  await sandbox.upload(bytes, `${EXEC_WORKDIR}/src.tgz`);

  const extracted = await sandbox.exec(
    [
      "tar xzf src.tgz",
      "rm -f src.tgz",
      "rm -rf node_modules .next dist build vendor target .git",
      "find . -maxdepth 2 -name '.env*' -delete",
      // A throwaway repository, so a diff and an ignore file exist. It has no
      // remote and no credentials; nothing can be pushed from here.
      "git init -q .",
      "git config user.name Openmi",
      "git config user.email openmi@users.noreply.github.com",
      "git add -A",
      "git -c commit.gpgsign=false commit -qm base",
    ].join(" && "),
    EXEC_WORKDIR
  );

  await event("output", extracted.output || "(seeded)");

  if (extracted.exitCode !== 0) {
    return { ok: false, detail: `The archive could not be extracted: ${extracted.output}` };
  }

  return { ok: true };
}

async function detect(
  repo: string,
  sha: string,
  token: string
): Promise<DetectedCommands | null> {
  try {
    const tree = await getTree(token, repo, sha);
    const paths = tree.entries
      .filter((entry) => entry.type === "blob")
      .map((entry) => entry.path);

    let packageJson: unknown = null;
    if (paths.includes("package.json")) {
      try {
        const file = await getFile(token, repo, sha, "package.json");
        packageJson = JSON.parse(file.text);
      } catch {
        packageJson = null;
      }
    }

    return detectCommands({ paths, packageJson });
  } catch {
    return null;
  }
}

async function applyFiles(
  sandbox: SandboxHandle,
  files: ProposedFile[],
  repo: string,
  event: (kind: "status" | "step" | "output" | "observation", body: string) => Promise<void>
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const directories = new Set<string>();

  for (const file of files) {
    const parts = file.path.split("/");
    if (parts.length > 1) directories.add(parts.slice(0, -1).join("/"));
  }

  if (directories.size > 0) {
    const listed = [...directories]
      .map((dir) => `'${dir.replace(/'/g, "'\\''")}'`)
      .join(" ");

    const made = await sandbox.exec(`mkdir -p ${listed}`, EXEC_WORKDIR);

    if (made.exitCode !== 0) {
      return { ok: false, detail: `Directories could not be created: ${made.output}` };
    }
  }

  for (const file of files) {
    const path = safeRepoPath(file.path);
    if (!path) {
      await event("observation", `skipped an unsafe path: ${file.path}`);
      continue;
    }

    try {
      await sandbox.upload(Buffer.from(file.content, "utf8"), `${EXEC_WORKDIR}/${path}`);
      await event("step", `applied ${path}`);
    } catch (caught) {
      return {
        ok: false,
        detail: `${path} could not be written: ${
          caught instanceof Error ? caught.message : "upload failed"
        }`,
      };
    }
  }

  await event("observation", `${files.length} file(s) applied to ${repo}`);
  return { ok: true };
}

/**
 * One repair pass: read what this turn changed, ask the model for whole files,
 * write them into the workspace, and keep the changeset in step with them.
 *
 * The changeset is updated rather than recreated, so the diff a reader sees
 * after a repair is the diff that will be committed — not the first attempt.
 */
async function repairOnce(input: {
  sandbox: SandboxHandle;
  admin: AdminClient;
  owner: string;
  model: string;
  repo: string;
  changesetId: string;
  command: string;
  exitCode: number;
  output: string;
  paths: string[];
  attempt: number;
  signal: AbortSignal;
  event: (kind: "status" | "step" | "output" | "observation", body: string) => Promise<void>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const files: Array<{ path: string; text: string }> = [];

  for (const path of input.paths) {
    const safe = safeRepoPath(path);
    if (!safe) continue;

    try {
      files.push({
        path: safe,
        text: await input.sandbox.readText(`${EXEC_WORKDIR}/${safe}`),
      });
    } catch {
      // A file that cannot be read is simply not shown to the model; it is
      // still in the workspace and still part of the changeset.
    }
  }

  const proposed = await requestRepair({
    model: input.model as ModelId,
    repo: input.repo,
    command: input.command,
    exitCode: input.exitCode,
    output: input.output,
    files,
    attempt: input.attempt,
    signal: input.signal,
  });

  if (!proposed.ok) return { ok: false, error: proposed.error };
  if (proposed.edits.length === 0) {
    return { ok: false, error: "the model proposed no edits" };
  }

  for (const edit of proposed.edits) {
    const path = safeRepoPath(edit.path);
    if (!path) return { ok: false, error: `${edit.path} is not a repository path` };

    const content = edit.content ?? "";

    try {
      await input.sandbox.upload(Buffer.from(content, "utf8"), `${EXEC_WORKDIR}/${path}`);
    } catch (caught) {
      return {
        ok: false,
        error: `${path} could not be written: ${
          caught instanceof Error ? caught.message : "upload failed"
        }`,
      };
    }

    const saved = await saveRepairedFile(input.admin, {
      changesetId: input.changesetId,
      owner: input.owner,
      path,
      content,
    });

    if (!saved.ok) return { ok: false, error: saved.error };

    await input.event("step", `repaired ${path}`);
  }

  return { ok: true };
}

async function saveRepairedFile(
  admin: AdminClient,
  input: { changesetId: string; owner: string; path: string; content: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await admin
    .from("changeset_files")
    .select("id, original_content")
    .eq("changeset_id", input.changesetId)
    .eq("path", input.path)
    .maybeSingle();

  const existing = data as { id: string; original_content: string | null } | null;
  const original = existing?.original_content ?? null;
  const diff = unifiedDiff(original ?? "", input.content);

  const row = {
    changeset_id: input.changesetId,
    owner: input.owner,
    path: input.path,
    mode: "write",
    original_content: original,
    proposed_content: input.content,
    diff: diff.text,
    additions: diff.additions,
    deletions: diff.deletions,
    diff_truncated: diff.truncated,
    accepted: true,
    error: null,
  };

  const { error } = existing
    ? await admin.from("changeset_files").update(row).eq("id", existing.id)
    : await admin.from("changeset_files").insert(row);

  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * The automatic approval.
 *
 * It re-signs first, because a repair changed the content and the signature
 * covers exactly that content. Then it calls the one approval function the
 * product has — the same one a click calls — so the branch namespace, the
 * default-branch refusal and the idempotency all still apply.
 */
async function autoApproveRun(input: {
  supabase: SessionClient;
  admin: AdminClient;
  owner: string;
  context: RunContext;
  sealKey: string | null;
  event: (kind: "status" | "step" | "output" | "observation", body: string) => Promise<void>;
}): Promise<void> {
  if (!input.sealKey) {
    await input.event(
      "observation",
      "the automatic approval could not sign the changeset: GITHUB_TOKEN_KEY is missing"
    );
    return;
  }

  const { data } = await input.admin
    .from("changeset_files")
    .select("path, proposed_content, accepted, error")
    .eq("changeset_id", input.context.changesetId);

  const accepted = ((data ?? []) as Array<{
    path: string;
    proposed_content: string;
    accepted: boolean;
    error: string | null;
  }>).filter((file) => file.accepted && file.error === null);

  if (accepted.length === 0) {
    await input.event("observation", "the automatic approval had no accepted files to commit");
    return;
  }

  const contentHash = changesetContentHash(
    accepted.map((file) => ({ path: file.path, proposed: file.proposed_content }))
  );
  const signature = signChangeset(
    {
      changesetId: input.context.changesetId,
      baseSha: input.context.baseSha,
      contentHash,
    },
    input.sealKey
  );

  const { error } = await input.admin
    .from("changesets")
    .update({ content_hash: contentHash, signature })
    .eq("id", input.context.changesetId);

  if (error) {
    await input.event("observation", `the automatic approval could not re-sign: ${error.message}`);
    return;
  }

  const approved = await approveChangesetAndOpenPullRequest(input.supabase, {
    changesetId: input.context.changesetId,
    owner: input.owner,
    sealKey: input.sealKey,
  });

  if (!approved.ok) {
    await input.event(
      "observation",
      `the automatic approval could not open a pull request: ${approved.error}`
    );
    return;
  }

  await input.event(
    "observation",
    approved.prUrl
      ? `the automatic approval opened ${approved.prUrl} on ${approved.branch}`
      : `the automatic approval committed ${approved.branch}`
  );
}
