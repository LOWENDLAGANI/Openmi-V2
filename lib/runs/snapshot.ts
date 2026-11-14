import type { SupabaseClient } from "@supabase/supabase-js";

import { readArtifact } from "./artifacts";
import { readSnapshot, type RunSnapshot } from "./store";

/**
 * The snapshot a reload starts from: rows plus the diff artifact's text.
 *
 * The diff is the one artifact the UI shows inline, so it is read here rather
 * than by a second request. Everything else stays metadata: a file's body is
 * only fetched when the reader asks for it.
 */
export type RunSnapshotWithDiff = RunSnapshot & { diff: string | null };

export async function readRunSnapshot(
  supabase: SupabaseClient,
  runId: string
): Promise<RunSnapshotWithDiff | null> {
  const snapshot = await readSnapshot(supabase, runId);
  if (!snapshot) return null;

  const diffArtifact = snapshot.artifacts.find((artifact) => artifact.kind === "diff");
  const diff = diffArtifact
    ? await readArtifact(diffArtifact.storage_key)
    : null;

  return { ...snapshot, diff };
}
