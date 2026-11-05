import "server-only";

import { approveChangesetAndOpenPullRequest } from "@/lib/changesets/commit";
import { getFile } from "@/lib/github/read";
import { settleExecutionDew } from "@/lib/dew/store";
import type { ModelId } from "@/lib/models";
import type { supabaseServer } from "@/lib/supabase/server";
import {
  providerKeys,
  providersFor,
  streamChat,
  type WireMessage,
} from "@/lib/providers";
import type { supabaseAdmin } from "@/lib/supabase/admin";

import { fetchRepoArchive } from "../archive";
import {
  attachSandbox,
  createSandbox,
  SandboxStartError,
  type ExecResult,
  type SandboxHandle,
} from "../provider";
import {
  MISSION_MAX_COMMANDS,
  MISSION_MAX_STEPS,
  MISSION_MAX_TOKENS,
  MISSION_TICK_MS,
  MISSION_WORKDIR,
  chargeMissionDuration,
  missionExpired,
  type MissionAutonomy,
} from "./budget";
import { createMissionChangeset } from "./changeset";
import { buildMissionPrompt } from "./prompt";
import {
  appendMissionMessage,
  claimTick,
  collectFromSandbox,
  completeCommand,
  countCommands,
  destroySandbox,
  readCommands,
  readMission,
  readMissionMessages,
  recordCommand,
  updateMission,
} from "./store";
import type { MissionRow } from "./status";
import {
  MAX_MISSION_LIST,
  MAX_MISSION_READ_BYTES,
  MAX_MISSION_SEARCH,
  MAX_MISSION_WRITE_BYTES,
  isProcessId,
  sanitiseWorkspacePath,
  shellQuote,
  toolsForAutonomy,
  validateCommandArguments,
  validateFinish,
  type FinishClaim,
} from "./tools";

/**
 * One tick of a mission.
 *
 * The tick is the unit that fits a serverless ceiling: it reattaches to the
 * sandbox the previous tick left, runs model decisions until the clock runs
 * out, and writes every command to the ledger before it runs. The browser's
 * poll advances the mission, so a closed tab shows `paused` — never a spinner
 * paying for work that is not happening.
 */

type Admin = NonNullable<ReturnType<typeof supabaseAdmin>>;
type SessionClient = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;

export type TickResult = {
  advanced: boolean;
  state: "running" | "paused" | "done" | "failed" | "timed_out" | "cancelled" | "stalled";
  detail?: string;
};

function parseArgs(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return {};

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function exitText(result: ExecResult): string {
  const status = `exit ${result.exitCode}${result.timedOut ? " (timed out)" : ""} in ${result.durationMs}ms`;
  return `${status}\n${result.output.length > 0 ? result.output : "(no output)"}`;
}

/** Fetches the archive and seeds the workspace once per mission. */
async function provision(
  admin: Admin,
  mission: MissionRow,
  token: string
): Promise<{ ok: true; sandbox: SandboxHandle } | { ok: false; failure: "repo_too_large" | "seed_failed" | "quota" | "refused" | "not_configured" | "missing"; detail: string }> {
  const archive = await fetchRepoArchive({
    token,
    repo: mission.repo_full_name,
    sha: mission.base_sha,
  });

  if (!archive.ok) {
    return { ok: false, failure: archive.failure, detail: archive.detail };
  }

  const minutes = Math.max(
    1,
    Math.round(
      (new Date(mission.deadline_at ?? Date.now()).getTime() -
        new Date(mission.started_at).getTime()) /
        60_000
    )
  );

  let sandbox: SandboxHandle;
  try {
    sandbox = await createSandbox(mission.id, {
      ttlMinutes: minutes + 5,
      labels: { kind: "mission" },
    });
  } catch (caught) {
    const failure =
      caught instanceof SandboxStartError ? caught.failure : ("refused" as const);
    return {
      ok: false,
      failure,
      detail: caught instanceof Error ? caught.message : "The sandbox could not be started.",
    };
  }

  await updateMission(admin, mission.id, {
    sandbox_id: sandbox.id,
    stage: "seed",
  });

  const made = await sandbox.exec(`mkdir -p ${MISSION_WORKDIR}`, ".", 60_000);

  if (made.exitCode !== 0) {
    return { ok: false, failure: "seed_failed", detail: made.output };
  }

  await sandbox.upload(archive.bytes, `${MISSION_WORKDIR}/src.tgz`);

  const extracted = await sandbox.exec(
    [
      "tar xzf src.tgz",
      "rm -f src.tgz",
      "rm -rf node_modules .next dist build vendor target .git",
      "find . -maxdepth 2 -name '.env*' -delete",
      "git init -q .",
      "git config user.name Openmi",
      "git config user.email openmi@users.noreply.github.com",
      "git add -A",
      "git -c commit.gpgsign=false commit -qm base",
    ].join(" && "),
    MISSION_WORKDIR,
    120_000
  );

  if (extracted.exitCode !== 0) {
    return {
      ok: false,
      failure: "seed_failed",
      detail: `The archive could not be extracted: ${extracted.output}`,
    };
  }

  return { ok: true, sandbox };
}

export async function runMissionTick(input: {
  admin: Admin;
  /** The request's own client, used only for a `ship` approval. */
  supabase: SessionClient;
  owner: string;
  runId: string;
  token: string;
  sealKey: string | null;
}): Promise<TickResult> {
  const { admin, owner, runId, token } = input;
  const tickStarted = Date.now();

  const claimed = await claimTick(admin, runId, tickStarted);

  // Another poll is already advancing this mission; doing nothing is correct
  // and is not an error the browser should show.
  if (!claimed) return { advanced: false, state: "running" };

  let mission: MissionRow = claimed;

  if (
    mission.status === "done" ||
    mission.status === "failed" ||
    mission.status === "timed_out" ||
    mission.status === "cancelled" ||
    mission.status === "stalled"
  ) {
    return { advanced: false, state: mission.status };
  }

  let sandbox: SandboxHandle | null = null;

  const settleAndDestroy = async (): Promise<void> => {
    const minutes = Math.max(
      1,
      Math.round(
        (new Date(mission.deadline_at ?? Date.now()).getTime() -
          new Date(mission.started_at).getTime()) /
          60_000
      )
    );

    const charged = sandbox
      ? chargeMissionDuration(Date.now() - new Date(mission.started_at).getTime(), minutes)
      : 0;

    await settleExecutionDew(admin, owner, runId, charged);
    await destroySandbox(sandbox?.id ?? mission.sandbox_id);
  };

  const end = async (patch: {
    status: "done" | "failed" | "timed_out" | "stalled";
    failure_code?: MissionRow["failure_code"];
    failure_detail?: string | null;
  }): Promise<TickResult> => {
    await updateMission(
      admin,
      runId,
      {
        status: patch.status,
        failure_code: patch.failure_code ?? null,
        failure_detail: patch.failure_detail ?? null,
        ended_at: new Date().toISOString(),
        commands_count: await countCommands(admin, runId),
      },
      { onlyWhileLive: true }
    );

    await settleAndDestroy();
    return { advanced: true, state: patch.status, detail: patch.failure_detail ?? undefined };
  };

  try {
    // Reattach or provision. The workspace outlives a tick; the handle does not.
    if (mission.sandbox_id) {
      try {
        sandbox = await attachSandbox(mission.sandbox_id);
      } catch {
        return await end({
          status: "failed",
          failure_code: "sandbox_expired",
          failure_detail: "The sandbox is gone, so the mission could not continue.",
        });
      }
    } else {
      const provisioned = await provision(admin, mission, token);

      if (!provisioned.ok) {
        await settleExecutionDew(admin, owner, runId, 0);
        await updateMission(admin, runId, {
          status: "failed",
          failure_code: provisioned.failure,
          failure_detail: provisioned.detail,
          ended_at: new Date().toISOString(),
        });
        return { advanced: true, state: "failed", detail: provisioned.detail };
      }

      sandbox = provisioned.sandbox;
      mission = (await readMission(admin, runId)) ?? mission;
    }

    if (missionExpired(mission.deadline_at)) {
      return await end({ status: "timed_out" });
    }

    await updateMission(admin, runId, { status: "running", stage: "work" });

    const autonomy: MissionAutonomy = mission.autonomy;
    const tools = toolsForAutonomy(autonomy);
    const prompt = buildMissionPrompt({
      goal: mission.goal ?? "Work the repository toward the user's goal.",
      repo: mission.repo_full_name,
      sha: mission.base_sha,
      autonomy,
      workspace: `${mission.sandbox_id ? "~/" : ""}${MISSION_WORKDIR}`,
      remainingMs: Math.max(
        0,
        new Date(mission.deadline_at ?? Date.now()).getTime() - Date.now()
      ),
      commandsUsed: await countCommands(admin, runId),
      maxCommands: MISSION_MAX_COMMANDS,
    });

    const history = await readMissionMessages(admin, runId);
    let kept = history.slice(-14);

    // A tool result without its assistant turn is an invalid conversation, so a
    // compacted window never starts in the middle of one.
    while (kept.length > 0 && kept[0].message.role === "tool") kept = kept.slice(1);

    const commandsSoFar = await readCommands(admin, runId, 20);
    const ledgerNote =
      commandsSoFar.length > 0
        ? `Commands already recorded in this mission (most recent last):\n${commandsSoFar
            .map(
              (row) =>
                `- [${row.exit_code === null ? "running" : `exit ${row.exit_code}`}] ${row.command}`
            )
            .join("\n")}`
        : "No command has been recorded in this mission yet.";

    const messages: WireMessage[] = [
      { role: "system", content: prompt },
      { role: "user", content: ledgerNote },
      ...kept.map((row) => row.message as WireMessage),
    ];

    let messageSeq = history.at(-1)?.seq ?? 0;
    let used = await countCommands(admin, runId);
    let steps = history.filter((row) => row.message.role === "assistant").length;
    let tokens = 0;
    let emptyDecisions = 0;
    let finished: { summary: string; checks: FinishClaim[] } | null = null;

    const pushTool = async (id: string, text: string): Promise<void> => {
      const message: WireMessage = {
        role: "tool",
        tool_call_id: id,
        content: text.slice(0, 20_000),
      };
      messageSeq += 1;
      await appendMissionMessage(admin, runId, messageSeq, message);
      messages.push(message);
    };

    while (!finished) {
      if (Date.now() - tickStarted > MISSION_TICK_MS) break;
      if (missionExpired(mission.deadline_at)) break;
      if (used >= MISSION_MAX_COMMANDS) break;
      if (steps >= MISSION_MAX_STEPS) break;
      if (tokens >= MISSION_MAX_TOKENS) break;

      const chain = providersFor((mission.model ?? "auto") as ModelId);

      if (chain.length === 0) {
        return await end({
          status: "failed",
          failure_code: "agent_failed",
          failure_detail: "This chat's model has no provider key configured.",
        });
      }

      let assistantText = "";
      const fragments = new Map<number, { id: string; name: string; args: string }>();
      let providerFailure: Error | null = null;
      let completed = false;

      for (const provider of chain) {
        try {
          for await (const event of streamChat({
            provider,
            apiKeys: providerKeys(provider),
            messages,
            tools,
            signal: AbortSignal.timeout(MISSION_TICK_MS),
          })) {
            if (event.type === "text") {
              assistantText += event.text;
              tokens += Math.max(1, Math.ceil(event.text.length / 4));
            } else {
              const existing = fragments.get(event.index) ?? { id: "", name: "", args: "" };
              fragments.set(event.index, {
                id: event.id ?? existing.id,
                name: event.name ?? existing.name,
                args: existing.args + (event.argumentsDelta ?? ""),
              });
            }
          }
          completed = true;
          providerFailure = null;
          break;
        } catch (caught) {
          providerFailure =
            caught instanceof Error ? caught : new Error("The provider failed.");
          if (assistantText.length > 0) break;
        }
      }

      if (!completed) {
        return await end({
          status: "failed",
          failure_code: "agent_failed",
          failure_detail: providerFailure?.message ?? "The model call failed.",
        });
      }

      steps += 1;

      const calls = [...fragments.values()].map((call, index) => ({
        id: call.id || `call_${steps}_${index}`,
        name: call.name,
        args: call.args,
      }));

      const assistant: WireMessage = {
        role: "assistant",
        content: assistantText,
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: call.args || "{}" },
        })),
      };

      messageSeq += 1;
      await appendMissionMessage(admin, runId, messageSeq, assistant);
      messages.push(assistant);

      // A turn that only talks is not progress. Three in a row inside one tick
      // is the loop this stops.
      if (calls.length === 0) {
        emptyDecisions += 1;
        if (emptyDecisions >= 3) break;
        continue;
      }

      emptyDecisions = 0;

      for (const call of calls) {
        const args = parseArgs(call.args);

        if (args === null) {
          await pushTool(call.id, "error: arguments were not a JSON object");
          continue;
        }

        if (call.name === "finish") {
          const validated = validateFinish(args, await readCommands(admin, runId));

          if (!validated.ok) {
            await pushTool(call.id, `error: ${validated.error}`);
            continue;
          }

          finished = { summary: validated.summary, checks: validated.checks };
          await pushTool(call.id, `finish accepted: ${validated.summary}`);
          break;
        }

        if (call.name === "run_command" || call.name === "start_process") {
          const validated = validateCommandArguments(args);

          if (!validated.ok) {
            await pushTool(call.id, `error: ${validated.error}`);
            continue;
          }

          if (used >= MISSION_MAX_COMMANDS) {
            await pushTool(
              call.id,
              `error: the mission has used its ${MISSION_MAX_COMMANDS}-command budget`
            );
            break;
          }

          used += 1;

          const background = call.name === "start_process";
          const processId = `p${used}`;
          const relLog = `.openmi/process-${processId}.log`;
          const relPid = `.openmi/process-${processId}.pid`;

          const command = background
            ? `mkdir -p .openmi && nohup setsid bash -c ${shellQuote(
                validated.command
              )} > ${relLog} 2>&1 & echo $! > ${relPid}`
            : `bash -c ${shellQuote(validated.command)}`;

          const cwd = validated.cwd
            ? `${MISSION_WORKDIR}/${validated.cwd}`
            : MISSION_WORKDIR;

          await recordCommand(admin, {
            runId,
            owner,
            seq: used,
            purpose: background ? `start: ${validated.purpose}` : validated.purpose,
            command: validated.command,
            cwd: validated.cwd || null,
          });

          const result = await (sandbox as SandboxHandle).exec(
            command,
            cwd,
            background ? 30_000 : validated.timeoutMs
          );

          await completeCommand(admin, runId, used, result);
          await updateMission(admin, runId, { commands_count: used });

          await pushTool(
            call.id,
            background
              ? `started ${processId} (${relLog})\n${exitText(result)}`
              : exitText(result)
          );

          continue;
        }

        if (call.name === "read_file") {
          const path = sanitiseWorkspacePath(args.path);

          if (!path) {
            await pushTool(call.id, "error: path must be a file inside the workspace");
            continue;
          }

          try {
            const text = await (sandbox as SandboxHandle).readText(
              `${MISSION_WORKDIR}/${path}`,
              MAX_MISSION_READ_BYTES
            );

            const lines = text.split("\n");
            const offset =
              typeof args.offset === "number" && args.offset > 0
                ? Math.trunc(args.offset)
                : 1;
            const limit =
              typeof args.limit === "number" && args.limit > 0
                ? Math.min(400, Math.trunc(args.limit))
                : 200;

            const shown = lines
              .slice(offset - 1, offset - 1 + limit)
              .map((line, index) => `${offset + index}: ${line}`)
              .join("\n");

            await pushTool(
              call.id,
              `${path} (${lines.length} lines; showing ${offset}..${Math.min(
                lines.length,
                offset - 1 + limit
              )})\n\n${shown}`
            );
          } catch (caught) {
            await pushTool(
              call.id,
              `error: ${caught instanceof Error ? caught.message : "the file could not be read"}`
            );
          }

          continue;
        }

        if (call.name === "write_file") {
          if (autonomy === "plan") {
            await pushTool(call.id, "error: this mission is planning only; no file was written");
            continue;
          }

          const path = sanitiseWorkspacePath(args.path);
          const content = args.content;

          if (!path) {
            await pushTool(call.id, "error: path must be a file inside the workspace");
            continue;
          }

          if (typeof content !== "string") {
            await pushTool(call.id, "error: content must be a string");
            continue;
          }

          const bytes = Buffer.byteLength(content, "utf8");

          if (bytes > MAX_MISSION_WRITE_BYTES) {
            await pushTool(
              call.id,
              `error: ${bytes} bytes is over the ${MAX_MISSION_WRITE_BYTES} byte write cap`
            );
            continue;
          }

          const directory = path.includes("/")
            ? path.slice(0, path.lastIndexOf("/"))
            : "";

          if (directory.length > 0) {
            await (sandbox as SandboxHandle).exec(
              `mkdir -p ${shellQuote(directory)}`,
              MISSION_WORKDIR,
              30_000
            );
          }

          try {
            await (sandbox as SandboxHandle).upload(
              Buffer.from(content, "utf8"),
              `${MISSION_WORKDIR}/${path}`
            );
            await pushTool(call.id, `wrote ${path} (${bytes} bytes)`);
          } catch (caught) {
            await pushTool(
              call.id,
              `error: ${caught instanceof Error ? caught.message : "the file could not be written"}`
            );
          }

          continue;
        }

        if (call.name === "list_files") {
          const directory = args.path === undefined ? "" : sanitiseWorkspacePath(args.path);

          if (args.path !== undefined && !directory) {
            await pushTool(call.id, "error: path must be a directory inside the workspace");
            continue;
          }

          const target = directory && directory.length > 0 ? shellQuote(directory) : ".";
          const listed = await (sandbox as SandboxHandle).exec(
            `find ${target} -maxdepth 4 -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.next/*' | head -n ${MAX_MISSION_LIST}`,
            MISSION_WORKDIR,
            60_000
          );

          await pushTool(
            call.id,
            listed.output.trim().length > 0
              ? listed.output
              : "(no files matched)"
          );
          continue;
        }

        if (call.name === "search_files") {
          const query = typeof args.query === "string" ? args.query.trim() : "";

          if (query.length < 2) {
            await pushTool(call.id, "error: query must be at least two characters");
            continue;
          }

          const directory = args.path === undefined ? "" : sanitiseWorkspacePath(args.path);

          if (args.path !== undefined && !directory) {
            await pushTool(call.id, "error: path must be a directory inside the workspace");
            continue;
          }

          const target = directory && directory.length > 0 ? shellQuote(directory) : ".";
          const found = await (sandbox as SandboxHandle).exec(
            `rg --fixed-strings --line-number --no-heading --max-count 1 -- ${shellQuote(
              query
            )} ${target} 2>/dev/null | head -n ${MAX_MISSION_SEARCH}`,
            MISSION_WORKDIR,
            60_000
          );

          await pushTool(
            call.id,
            found.output.trim().length > 0 ? found.output : "(no matches)"
          );
          continue;
        }

        if (call.name === "read_process") {
          if (!isProcessId(args.id)) {
            await pushTool(call.id, "error: id must be the value start_process returned");
            continue;
          }

          const lines = typeof args.lines === "number" ? Math.min(200, Math.max(1, Math.trunc(args.lines))) : 80;
          const read = await (sandbox as SandboxHandle).exec(
            `tail -n ${lines} .openmi/process-${args.id}.log 2>/dev/null || echo "(no output yet)"`,
            MISSION_WORKDIR,
            30_000
          );

          await pushTool(call.id, read.output);
          continue;
        }

        if (call.name === "kill_process") {
          if (!isProcessId(args.id)) {
            await pushTool(call.id, "error: id must be the value start_process returned");
            continue;
          }

          const killed = await (sandbox as SandboxHandle).exec(
            `if [ -f .openmi/process-${args.id}.pid ]; then kill -TERM -$(cat .openmi/process-${args.id}.pid) 2>/dev/null || kill -TERM $(cat .openmi/process-${args.id}.pid) 2>/dev/null; echo stopped; else echo "no such process"; fi`,
            MISSION_WORKDIR,
            30_000
          );

          await pushTool(call.id, killed.output);
          continue;
        }

        await pushTool(call.id, `error: unknown tool ${call.name}`);
      }
    }

    // ---- outcome -----------------------------------------------------------

    const commandsUsed = await countCommands(admin, runId);

    if (!finished) {
      if (missionExpired(mission.deadline_at)) {
        const kept = await collectDiff({ admin, mission, sandbox, token, sealKey: input.sealKey });

        if (kept.ok) {
          await updateMission(admin, runId, {
            changed_files: kept.files,
            diff_bytes: kept.bytes,
          });
        }

        return await end({ status: "timed_out" });
      }

      if (used >= MISSION_MAX_COMMANDS || steps >= MISSION_MAX_STEPS || tokens >= MISSION_MAX_TOKENS) {
        const kept = await collectDiff({ admin, mission, sandbox, token, sealKey: input.sealKey });

        if (kept.ok) {
          await updateMission(admin, runId, {
            changed_files: kept.files,
            diff_bytes: kept.bytes,
          });
        }

        return await end({
          status: "failed",
          failure_code: "budget_exhausted",
          failure_detail: `The mission stopped at its budget: ${used} command(s), ${steps} decision(s), ${tokens} token(s).`,
        });
      }

      if (emptyDecisions >= 3) {
        return await end({
          status: "stalled",
          failure_code: "stalled",
          failure_detail: "Three model turns produced no action and no finish.",
        });
      }

      await updateMission(admin, runId, {
        status: "running",
        stage: "work",
        commands_count: commandsUsed,
        last_tick_at: new Date().toISOString(),
      });

      return { advanced: true, state: "running" };
    }

    const collected = await collectDiff({
      admin,
      mission,
      sandbox,
      token,
      sealKey: input.sealKey,
    });

    if (!collected.ok) {
      return await end({
        status: "failed",
        failure_code: "collect_failed",
        failure_detail: collected.error,
      });
    }

    await updateMission(admin, runId, {
      changed_files: collected.files,
      diff_bytes: collected.bytes,
      commands_count: commandsUsed,
    });

    // Ship mode is the only path that writes to GitHub without a click, and it
    // is the same approval function a click calls: the branch namespace, the
    // default-branch refusal and the Openmi author all still apply. It requires
    // at least one recorded check that really exited 0, because "ship" without
    // a verification is just "push".
    if (autonomy === "ship") {
      const completion = finished;

      if (!completion || completion.checks.length === 0) {
        return await end({
          status: "failed",
          failure_code: "refused",
          failure_detail:
            "Ship mode needs at least one recorded check that exited 0 before it opens a pull request.",
        });
      }

      if (!collected.changesetId) {
        return await end({
          status: "failed",
          failure_code: "no_changes",
          failure_detail: "Ship mode found nothing to commit.",
        });
      }

      if (!input.sealKey) {
        return await end({
          status: "failed",
          failure_code: "refused",
          failure_detail:
            "The diff was collected, but GITHUB_TOKEN_KEY is missing, so it cannot be signed for approval.",
        });
      }

      const approved = await approveChangesetAndOpenPullRequest(input.supabase, {
        changesetId: collected.changesetId,
        owner: input.owner,
        sealKey: input.sealKey,
      });

      if (!approved.ok) {
        return await end({
          status: "failed",
          failure_code: "refused",
          failure_detail: `The diff was collected, but the pull request could not be opened: ${approved.error}`,
        });
      }
    }

    return await end({ status: "done" });
  } catch (caught) {
    return await end({
      status: "failed",
      failure_code: "agent_failed",
      failure_detail:
        caught instanceof Error ? caught.message : "The mission failed unexpectedly.",
    });
  }
}

/**
 * Collects the workspace once, at the end. A failed collection is reported as a
 * failure rather than as "done with no diff": the two mean different things.
 */
async function collectDiff(input: {
  admin: Admin;
  mission: MissionRow;
  sandbox: SandboxHandle | null;
  token: string;
  sealKey: string | null;
}): Promise<
  | { ok: true; files: number; bytes: number; changesetId: string | null }
  | { ok: false; error: string }
> {
  if (!input.sandbox) {
    return { ok: true, files: 0, bytes: 0, changesetId: null };
  }

  const collected = await collectFromSandbox({
    sandbox: input.sandbox,
    repo: input.mission.repo_full_name,
    baseSha: input.mission.base_sha,
    token: input.token,
    readBase: async (path) => {
      try {
        const file = await getFile(
          input.token,
          input.mission.repo_full_name,
          input.mission.base_sha,
          path
        );
        return file.text;
      } catch {
        // A path that did not exist at the base commit is a new file.
        return null;
      }
    },
  });

  if (!collected.ok) {
    return { ok: false, error: collected.detail };
  }

  if (collected.files.length === 0) {
    return { ok: true, files: 0, bytes: 0, changesetId: null };
  }

  const changeset = await createMissionChangeset(input.admin, {
    owner: input.mission.owner,
    chatId: input.mission.chat_id,
    missionId: input.mission.id,
    repo: input.mission.repo_full_name,
    baseSha: input.mission.base_sha,
    files: collected.files,
    sealKey: input.sealKey,
  });

  if (!changeset.ok) {
    return { ok: false, error: changeset.error };
  }

  return {
    ok: true,
    files: changeset.files,
    bytes: collected.bytes,
    changesetId: changeset.id,
  };
}
