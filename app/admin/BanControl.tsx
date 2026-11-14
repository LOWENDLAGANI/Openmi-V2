import { SubmitButton } from "@/components/SubmitButton";

import { banUser, unbanUser } from "./actions";

/**
 * Stop or restore one account, from wherever an operator is looking at it.
 *
 * Two states, because that is the whole decision: an account is either running
 * normally and can be stopped with a reason and a duration, or it is stopped and
 * can be restored. The reason is required by the RPC and shown on /banned.
 *
 * A server component: both actions are server actions, so no client state is
 * needed and the failure path is a redirect with a message, like the rest of
 * this panel.
 */
export function BanControl({
  userId,
  banned,
  summary = "stop",
}: {
  userId: string;
  banned: { until: string | null } | null;
  summary?: string;
}) {
  if (banned) {
    const until = banned.until
      ? `${banned.until.slice(0, 16).replace("T", " ")} UTC`
      : null;

    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-danger">
          {until ? `until ${until}` : "permanent"}
        </span>
        <form action={unbanUser}>
          <input type="hidden" name="userId" value={userId} />
          <SubmitButton
            className="btn btn-quiet px-2.5 py-1 text-[10.5px]"
            pendingText="Lifting…"
            optimisticText="Lifted"
          >
            lift ban
          </SubmitButton>
        </form>
      </div>
    );
  }

  return (
    <details className="w-full sm:w-auto">
      <summary className="eyebrow cursor-pointer hover:text-hi">{summary}</summary>
      <form action={banUser} className="mt-2 flex flex-wrap items-center gap-1.5">
        <input type="hidden" name="userId" value={userId} />
        <input
          name="reason"
          required
          maxLength={200}
          placeholder="reason, shown to them"
          aria-label="Reason for stopping this account"
          className="field w-56 py-1 text-[11px]"
        />
        <select
          name="hours"
          defaultValue="24"
          aria-label="How long the stop lasts"
          className="field w-28 py-1 text-[11px]"
        >
          <option value="24">24 hours</option>
          <option value="168">7 days</option>
          <option value="">permanent</option>
        </select>
        <SubmitButton
          className="btn btn-quiet px-2.5 py-1 text-[10.5px]"
          pendingText="Stopping…"
          optimisticText="Stopped"
        >
          stop
        </SubmitButton>
      </form>
    </details>
  );
}
