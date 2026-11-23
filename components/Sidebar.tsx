import {
  Activity,
  Bug,
  CreditCard,
  FolderGit2,
  Lightbulb,
  LogOut,
  SquarePen,
  Trash2,
} from "lucide-react";
import Link from "next/link";

import { ChatList } from "@/components/ChatList";
import { HourCountdown } from "@/components/HourCountdown";
import { InstallPrompt } from "@/components/InstallPrompt";
import { OpenmiMark } from "@/components/OpenmiMark";
import { SearchLauncher } from "@/components/SearchLauncher";
import { SubmitButton } from "@/components/SubmitButton";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { VersionBadge } from "@/components/VersionBadge";
import type { Chat, Folder } from "@/lib/types";

export function Sidebar({
  email,
  folders,
  chats,
  activeChatId,
  trashView,
  trashedCount,
  repo,
  hourEndsAt,
  hourServerNow,
}: {
  email: string;
  folders: Folder[];
  chats: Chat[];
  activeChatId?: string;
  trashView: boolean;
  trashedCount: number;
  repo?: { fullName: string; branch: string; sha: string } | null;
  hourEndsAt?: string | null;
  hourServerNow?: string | null;
}) {
  const newChatHref = repo
    ? `/chat?new=1&repo=${encodeURIComponent(repo.fullName)}&branch=${encodeURIComponent(repo.branch)}&sha=${encodeURIComponent(repo.sha)}`
    : "/chat?new=1";

  const initial = email.trim().charAt(0).toUpperCase() || "?";

  return (
    <aside className="flex h-full min-h-0 flex-col bg-raised md:border-r md:border-line">
      <div className="safe-top flex h-13 shrink-0 items-center justify-between border-b border-line px-4">
        <Link
          href="/chat"
          aria-label="Openmi — start a new chat"
          className="flex min-w-0 items-center gap-2.5"
        >
          <OpenmiMark size={20} className="shrink-0" />
          <span className="truncate text-[15px] font-semibold leading-none tracking-[-0.03em] text-hi">
            Openmi
          </span>
        </Link>
        <VersionBadge />
      </div>

      <div className="space-y-2 px-3 pt-3">
        <Link
          href={newChatHref}
          aria-label="New chat"
          className="rail-cta flex h-9 w-full items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-hi shadow-[var(--card-shadow)]"
        >
          <SquarePen aria-hidden="true" className="size-4 text-accent-text" strokeWidth={1.75} />
          <span>New chat</span>
        </Link>

        <SearchLauncher />
      </div>

      {hourEndsAt && hourServerNow ? (
        <HourCountdown endsAt={hourEndsAt} serverNow={hourServerNow} />
      ) : null}

      <nav aria-label="Workspace navigation" className="mt-3 space-y-0.5 px-2">
        <Link
          href="/chat?view=repos"
          className="rail-row flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-mid"
        >
          <FolderGit2 aria-hidden="true" className="size-4 shrink-0 text-low" strokeWidth={1.75} />
          <span>Repositories</span>
        </Link>
        <Link
          href="/activity"
          className="rail-row flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-mid"
        >
          <Activity aria-hidden="true" className="size-4 shrink-0 text-low" strokeWidth={1.75} />
          <span>Credit &amp; activity</span>
        </Link>
        <Link
          href="/pay"
          className="rail-row flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-mid"
        >
          <CreditCard aria-hidden="true" className="size-4 shrink-0 text-low" strokeWidth={1.75} />
          <span>Plans &amp; billing</span>
        </Link>
        <Link
          href="/report"
          className="rail-row flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-mid"
        >
          <Bug aria-hidden="true" className="size-4 shrink-0 text-low" strokeWidth={1.75} />
          <span>Report problem</span>
        </Link>
        <Link
          href="/suggestions"
          className="rail-row flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-mid"
        >
          <Lightbulb aria-hidden="true" className="size-4 shrink-0 text-low" strokeWidth={1.75} />
          <span>Suggestions</span>
        </Link>
        <Link
          href={trashView ? "/chat" : "/chat?trash=1"}
          aria-label={trashView ? "Back to chats" : `Trash, ${trashedCount} chat(s)`}
          aria-current={trashView ? "page" : undefined}
          className="rail-row flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-mid"
        >
          <span className="flex items-center gap-2.5">
            <Trash2 aria-hidden="true" className="size-4 shrink-0 text-low" strokeWidth={1.75} />
            <span>{trashView ? "Back to chats" : "Trash"}</span>
          </span>
          {trashedCount > 0 && (
            <span className="rounded-md border border-line bg-card px-1.5 py-0.5 font-mono text-[10.5px] leading-none tabular-nums text-mid">
              {trashedCount > 99 ? "99+" : trashedCount}
            </span>
          )}
        </Link>
      </nav>

      <div className="mx-3 mt-3 border-t border-line" />

      <ChatList chats={chats} folders={folders} activeChatId={activeChatId} />

      <div className="safe-bottom border-t border-line px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-card font-mono text-[11px] font-semibold text-hi"
          >
            {initial}
          </span>

          <span
            className="min-w-0 flex-1 truncate text-[12px] font-medium text-mid"
            title={email}
          >
            {email}
          </span>

          <ThemeSwitcher variant="icon" />

          <InstallPrompt />

          <form action="/auth/signout" method="post" className="shrink-0">
            <SubmitButton
              ariaLabel="Sign out"
              title="Sign out"
              pendingText=""
              className="rail-icon grid size-8 place-items-center rounded-lg"
            >
              <LogOut aria-hidden="true" className="size-4" strokeWidth={1.75} />
            </SubmitButton>
          </form>
        </div>

        <div className="mt-2 flex items-center justify-between border-t border-line/70 pt-2">
          <span className="font-mono text-[10.5px] text-low">Openmi build</span>
          <VersionBadge />
        </div>
      </div>
    </aside>
  );
}
