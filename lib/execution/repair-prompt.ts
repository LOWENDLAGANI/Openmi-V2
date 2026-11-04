/**
 * The repair contract, without the network.
 *
 * Kept separate from `repair.ts` so the prompt and the parser can be tested
 * without a provider or a `server-only` import. The rules are here rather than
 * in the model's instructions because a model that ignores them has to be
 * refused by code, not asked again.
 */

import { MAX_EDIT_BYTES, validateEdits, type EditRequest } from "@/lib/changesets";
import type { WireMessage } from "@/lib/providers";

export const MAX_REPAIR_PASSES = 2;
export const REPAIR_OUTPUT_CHARS = 6_000;
export const REPAIR_FILE_CHARS = 24_000;

export type WorkspaceFile = { path: string; text: string };

export function buildRepairMessages(input: {
  repo: string;
  command: string;
  exitCode: number;
  output: string;
  files: WorkspaceFile[];
  attempt: number;
}): WireMessage[] {
  const fileBlock = input.files
    .map(
      (file) =>
        `<file path="${file.path}">\n${file.text.slice(0, REPAIR_FILE_CHARS)}\n</file>`
    )
    .join("\n\n");

  return [
    {
      role: "system",
      content: [
        "You are repairing a build that failed in a Linux workspace.",
        `Repository: ${input.repo}.`,
        "Return JSON only, with no prose and no code fence:",
        '{"edits":[{"path":"relative/path","mode":"write","content":"the complete new file"}]}',
        "Rules:",
        "- Whole-file writes only. No shell commands, no patches, no installs.",
        "- At most six files per answer.",
        `- Each file must be under ${MAX_EDIT_BYTES} bytes.`,
        "- Change as little as the failure requires. Do not refactor.",
        '- If the failure cannot be fixed by editing these files, return {"edits":[]}.',
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Repair attempt ${input.attempt} of ${MAX_REPAIR_PASSES}.`,
        `Command: ${input.command}`,
        `Exit code: ${input.exitCode}`,
        "Output tail:",
        "```",
        input.output.slice(-REPAIR_OUTPUT_CHARS),
        "```",
        "Files changed by this turn:",
        fileBlock.length > 0 ? fileBlock : "(none)",
      ].join("\n"),
    },
  ];
}

/** Accepts a bare object, a fenced block, or JSON with prose around it. */
export function parseRepairEdits(
  raw: string
): { ok: true; edits: EditRequest[] } | { ok: false; error: string } {
  const withoutFence = raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();

  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");

  if (start < 0 || end <= start) {
    return { ok: false, error: "the answer contained no JSON object" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFence.slice(start, end + 1));
  } catch {
    return { ok: false, error: "the answer was not valid JSON" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "the answer was not a JSON object" };
  }

  const validated = validateEdits((parsed as { edits?: unknown }).edits);
  if (!validated.ok) return { ok: false, error: validated.error };

  // A replacement anchor cannot be checked against a workspace the model has
  // only partly seen, so a repair may only restate whole files.
  for (const edit of validated.edits) {
    if (edit.mode !== "write") {
      return {
        ok: false,
        error:
          "a repair must replace whole files; a partial anchor could not be checked against the workspace",
      };
    }
  }

  return { ok: true, edits: validated.edits };
}
