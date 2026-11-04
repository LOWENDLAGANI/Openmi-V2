import "server-only";

import { providerKeys, providersFor, streamChat } from "@/lib/providers";
import type { ModelId } from "@/lib/models";
import type { EditRequest } from "@/lib/changesets";

import { buildRepairMessages, parseRepairEdits, type WorkspaceFile } from "./repair-prompt";

export { MAX_REPAIR_PASSES, parseRepairEdits } from "./repair-prompt";
export type { WorkspaceFile } from "./repair-prompt";

/**
 * One repair completion, without tools.
 *
 * A refusal is a real observation rather than a crash: the caller records why
 * the pass produced nothing usable and stops trying, instead of looping a
 * broken model until the sandbox cap runs out.
 */
export async function requestRepair(input: {
  model: ModelId;
  repo: string;
  command: string;
  exitCode: number;
  output: string;
  files: WorkspaceFile[];
  attempt: number;
  signal: AbortSignal;
}): Promise<{ ok: true; edits: EditRequest[] } | { ok: false; error: string }> {
  const chain = providersFor(input.model);

  if (chain.length === 0) {
    return { ok: false, error: "the model's provider key is not configured" };
  }

  const messages = buildRepairMessages(input);
  let text = "";
  let failure: Error | null = null;

  for (const provider of chain) {
    try {
      for await (const event of streamChat({
        provider,
        apiKeys: providerKeys(provider),
        messages,
        tools: [],
        signal: input.signal,
      })) {
        if (event.type === "text") text += event.text;
      }
      failure = null;
      break;
    } catch (caught) {
      failure = caught instanceof Error ? caught : new Error("the provider failed");
      if (text.length > 0 || input.signal.aborted) break;
    }
  }

  if (failure) return { ok: false, error: failure.message };
  if (input.signal.aborted) return { ok: false, error: "the repair was cancelled" };

  return parseRepairEdits(text);
}
