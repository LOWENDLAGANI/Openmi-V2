"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Starting a run is a form, not a chat.
 *
 * The browser sends a prompt and gets a run id back; it never holds the loop.
 * Quota is shown before the button is pressed, because a refusal after the
 * click is a worse way to learn the number.
 */

type ChatOption = {
  id: string;
  title: string;
  repo: string | null;
};

type Quota = {
  active: number;
  runsToday: number;
  tokensToday: number;
};

type Limits = {
  concurrent: number;
  dailyRuns: number;
  dailyTokens: number;
};

export function AgentLauncher({ chats }: { chats: ChatOption[] }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [chatId, setChatId] = useState(chats[0]?.id ?? "");
  const [quota, setQuota] = useState<Quota | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/runs", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { quota?: Quota; limits?: Limits } | null) => {
        if (cancelled || !body) return;
        setQuota(body.quota ?? null);
        setLimits(body.limits ?? null);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          chatId: chatId.length > 0 ? chatId : null,
        }),
      });

      const body = (await response.json().catch(() => null)) as
        | { runId?: string; error?: string }
        | null;

      if (!response.ok || !body?.runId) {
        setError(body?.error ?? "The run could not be started.");
        return;
      }

      router.push(`/agent/${body.runId}`);
    } catch {
      setError("The run could not be started: the request did not reach the server.");
    } finally {
      setPending(false);
    }
  }

  const used = quota?.runsToday ?? 0;
  const dailyRuns = limits?.dailyRuns ?? 20;
  const remaining = Math.max(0, dailyRuns - used);

  return (
    <form onSubmit={submit} className="rounded-3xl border border-line bg-raised p-5">
      <label htmlFor="agent-prompt" className="text-[13px] font-medium text-hi">
        What should the agent do?
      </label>

      <textarea
        id="agent-prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={5}
        maxLength={24_000}
        placeholder="Fix the failing build in this repository, run it, and show me the diff."
        className="mt-2 w-full resize-y rounded-2xl border border-line bg-canvas px-4 py-3 text-[14px] leading-6 text-hi outline-none focus-visible:border-line-strong"
      />

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <label htmlFor="agent-chat" className="text-[12px] text-low">
            Workspace
          </label>
          <select
            id="agent-chat"
            value={chatId}
            onChange={(event) => setChatId(event.target.value)}
            className="mt-1 block w-full min-w-0 rounded-xl border border-line bg-canvas px-3 py-2 text-[13px] text-hi sm:w-72"
          >
            <option value="">Empty workspace</option>
            {chats.map((chat) => (
              <option key={chat.id} value={chat.id}>
                {chat.repo ?? chat.title}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={pending || prompt.trim().length === 0}
          className="rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-on-accent disabled:opacity-50"
        >
          {pending ? "Queueing…" : "Start run"}
        </button>
      </div>

      <p className="mt-3 text-[12px] leading-5 text-low">
        {quota
          ? `${remaining} of ${dailyRuns} runs left today · ${
              quota.tokensToday.toLocaleString()
            } tokens used · ${limits?.concurrent ?? 1} at a time.`
          : "Runs execute on the server in an isolated workspace; closing this tab does not stop one."}
      </p>

      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-line bg-accent-soft px-3 py-2 text-[12px] text-hi">
          {error}
        </p>
      ) : null}

      <p className="mt-2 text-[11px] text-low">
        A run is created queued and executed by the worker. You can watch it, cancel it, and
        read the diff without keeping the page open.
      </p>

      <p className="mt-1 text-[11px] text-low">
        Looking for the chat? <Link href="/chat" className="underline">It still works</Link>; this
        page is the run surface.
      </p>
    </form>
  );
}
