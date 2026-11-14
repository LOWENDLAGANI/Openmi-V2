import { notFound } from "next/navigation";

import { RunView } from "@/components/RunView";
import { readRunSnapshot } from "@/lib/runs/snapshot";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * One run, served as a snapshot.
 *
 * The page renders the server's current state on the first paint, then the
 * client subscribes from the last event it was given. A reload therefore shows
 * the correct status before any JavaScript has spoken to the network.
 */
export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession(`/agent/${id}`);
  const snapshot = await readRunSnapshot(session.supabase, id);

  if (!snapshot) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <RunView initial={snapshot} />
    </main>
  );
}
