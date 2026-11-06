import Link from "next/link";

import { OpenmiMark } from "@/components/OpenmiMark";
import { SearchLauncher } from "@/components/SearchLauncher";
import { SubmitButton } from "@/components/SubmitButton";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import type { Chat, Folder } from "@/lib/types";
import {
  createFolder,
  deleteFolder,
  moveChatToFolder,
  renameFolder,
  trashChat,
} from "@/app/chat/actions";

/**
 * The sidebar is a list, not a control panel.
 *
 * Search at the top, one row per destination, then the chats under a hairline.
 * Everything that used to compete for attention — the marketing chip, the
 * theme control, the plans links — either moved into a row that names a place
 * or into the account bar at the bottom, where the three small controls live as
 * icons. Rows are tall enough to hit on a phone, and the type is the same
 * grotesk the rest of the product uses.
 */

const GLYPHS = {
  cloud: (
    <path d="M7.4 18h9.8a3.9 3.9 0 0 0 .5-7.77 5.7 5.7 0 0 0-10.86-1.4A3.6 3.6 0 0 0 7.4 18Z" />
  ),
  folder: (
    <path d="M3.8 7.6a2 2 0 0 1 2-2h3.1l1.8 2.1h7.5a2 2 0 0 1 2 2v6.7a2 2 0 0 1-2 2H5.8a2 2 0 0 1-2-2Z" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.6V12l3 1.8" />
    </>
  ),
  receipt: (
    <>
      <path d="M6.5 4.5h11v15l-2.2-1.4-1.6 1.4-1.7-1.4L10.3 19l-1.6-1.4-2.2 1.4Z" />
      <path d="M9.6 9.2h4.8M9.6 12.5h4.8" />
    </>
  ),
  compose: (
    <>
      <path d="M4.4 19.6h4.1L19 9.1a2.1 2.1 0 0 0-3-3L5.5 16.6Z" />
      <path d="m14.9 7.3 1.8 1.8" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7.5h14M9.5 7.5V5.9a1.4 1.4 0 0 1 1.4-1.4h2.2a1.4 1.4 0 0 1 1.4 1.4v1.6" />
      <path d="M7 7.5l.8 11a1.6 1.6 0 0 0 1.6 1.5h5.2a1.6 1.6 0 0 0 1.6-1.5l.8-11" />
      <path d="M10.5 11v5M13.5 11v5" />
    </>
  ),
  signout: (
    <>
      <path d="M14.5 5.5H18a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 18 18.5h-3.5" />
      <path d="M10 8.5 6.5 12l3.5 3.5M6.5 12H15" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
} as const;

type GlyphName = keyof typeof GLYPHS;

function Glyph({
  name,
  className = "size-5",
}: {
  name: GlyphName;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {GLYPHS[name]}
    </svg>
  );
}

function NavRow({
  href,
  label,
  icon,
  active = false,
  badge,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="rail-row flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px]"
    >
      <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge && (
        <span className="shrink-0 rounded-full bg-accent-soft px-2 py-[3px] font-mono text-[9px] uppercase tracking-[0.1em] text-accent-text">
          {badge}
        </span>
      )}
    </Link>
  );
}

function ChatRow({
  chat,
  active,
  folders,
}: {
  chat: Chat;
  active: boolean;
  folders: Folder[];
}) {
  return (
    <div
      data-active={active}
      className="rail-row group relative flex items-center rounded-xl"
    >
      <Link
        href={`/chat?chat=${chat.id}`}
        aria-current={active ? "page" : undefined}
        title={chat.title}
        className="flex min-w-0 flex-1 items-center gap-2 py-2.5 pl-3 pr-1"
      >
        <span
          className={`min-w-0 flex-1 truncate text-[13px] ${active ? "font-medium" : ""}`}
        >
          {chat.title}
        </span>
      </Link>

      <details className="relative shrink-0 pr-1.5">
        <summary
          className="grid size-7 cursor-pointer list-none place-items-center rounded-full text-[14px] leading-none text-low opacity-0 transition-opacity hover:bg-canvas hover:text-hi focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
          aria-label={`Options for ${chat.title}`}
        >
          ⋯
        </summary>
        <div className="animate-pop absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-line bg-card p-1.5 shadow-[0_18px_40px_-24px_rgba(17,24,39,0.28)]">
          <form action={moveChatToFolder} className="flex gap-1.5">
            <input type="hidden" name="chatId" value={chat.id} />
            <select
              name="folderId"
              defaultValue={chat.folder_id ?? ""}
              aria-label="Folder"
              className="field min-w-0 flex-1 px-2 py-1 text-[11px]"
            >
              <option value="">No folder</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
            <SubmitButton className="btn px-2 py-1 text-[11px]" pendingText="Moving…">
              Move
            </SubmitButton>
          </form>

          <form action={trashChat} className="mt-1.5 border-t border-line pt-1.5">
            <input type="hidden" name="chatId" value={chat.id} />
            <SubmitButton
              className="w-full rounded-lg px-2 py-1.5 text-left text-[11px] text-mid hover:bg-hover hover:text-hi"
              pendingText="Moving to trash…"
            >
              Move to trash
            </SubmitButton>
          </form>
        </div>
      </details>
    </div>
  );
}

export function Sidebar({
  email,
  folders,
  chats,
  activeChatId,
  trashView,
  trashedCount,
  repo,
}: {
  email: string;
  folders: Folder[];
  chats: Chat[];
  activeChatId?: string;
  trashView: boolean;
  trashedCount: number;
  repo?: { fullName: string; branch: string; sha: string } | null;
}) {
  // A new chat should start where the reader already is. Without the repo in
  // this link, picking a repository and pressing "New chat" dropped the
  // repository and the first answer had nothing to cite.
  const newChatHref = repo
    ? `/chat?new=1&repo=${encodeURIComponent(repo.fullName)}&branch=${encodeURIComponent(repo.branch)}&sha=${encodeURIComponent(repo.sha)}`
    : "/chat?new=1";

  const ungrouped = chats.filter((chat) => !chat.folder_id);
  const inFolder = (folderId: string) =>
    chats.filter((chat) => chat.folder_id === folderId);

  const initial = email.trim().charAt(0).toUpperCase() || "?";

  return (
    <aside className="flex h-full min-h-0 flex-col bg-bg-raised md:border-r md:border-line">
      {/* The reference opens the rail with the wordmark, not a search field:
          identity first, then the one action worth being large, then a strip of
          tools that are icons because every one of them is familiar. */}
      <div className="safe-top flex items-center justify-between px-5 pb-4 pt-6">
        <Link
          href="/chat"
          aria-label="Openmi — start a new chat"
          className="flex min-w-0 items-center gap-3"
        >
          <OpenmiMark size={36} className="shrink-0" />
          <span className="min-w-0">
            <span className="block truncate text-[23px] font-semibold leading-none tracking-[-0.045em] text-hi">
              Openmi
            </span>
          </span>
        </Link>
      </div>

      <div className="px-4">
        <Link
          href={newChatHref}
          aria-label="New chat"
          className="rail-cta flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-[14px] font-medium text-hi"
        >
          <Glyph name="compose" className="size-[18px]" />
          New chat
        </Link>
      </div>

      {/* Five tools, five icons: search, the repository picker, spending, plans
          and trash. Named rows would eat the height the conversation list needs
          to breathe, and each of these is reachable by title and label. */}
      <div
        role="toolbar"
        aria-label="Openmi tools"
        className="mt-4 flex items-center justify-between px-4"
      >
        <SearchLauncher />
        <Link
          href="/chat?view=repos"
          aria-label="Repositories"
          title="Repositories"
          className="rail-icon grid size-10 place-items-center rounded-xl"
        >
          <Glyph name="folder" className="size-[19px]" />
        </Link>
        <Link
          href="/activity"
          aria-label="Activity"
          title="Activity"
          className="rail-icon grid size-10 place-items-center rounded-xl"
        >
          <Glyph name="clock" className="size-[19px]" />
        </Link>
        <Link
          href="/pay"
          aria-label="Plans and receipts"
          title="Plans and receipts"
          className="rail-icon grid size-10 place-items-center rounded-xl"
        >
          <Glyph name="receipt" className="size-[19px]" />
        </Link>
        <Link
          href={trashView ? "/chat" : "/chat?trash=1"}
          aria-label={trashView ? "Back to chats" : `Trash, ${trashedCount} chat(s)`}
          title={trashView ? "Back to chats" : "Trash"}
          aria-current={trashView ? "page" : undefined}
          className="rail-icon relative grid size-10 place-items-center rounded-xl"
        >
          <Glyph name="trash" className="size-[19px]" />
          {trashedCount > 0 && (
            <span className="pointer-events-none absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[8px] font-bold text-on-accent">
              {trashedCount > 99 ? "99+" : trashedCount}
            </span>
          )}
        </Link>
      </div>

      <nav aria-label="Chats" className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <p className="px-3 pb-1.5 pt-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-low">
          Chats
        </p>

        {ungrouped.length === 0 ? (
          <p className="px-3 pb-1.5 text-[11.5px] leading-relaxed text-low">
            Nothing here yet.
          </p>
        ) : (
          <div className="space-y-0.5">
            {ungrouped.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                active={chat.id === activeChatId}
                folders={folders}
              />
            ))}
          </div>
        )}

        {folders.map((folder) => {
          const items = inFolder(folder.id);

          return (
            <details key={folder.id} open className="mt-1">
              <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl px-3 py-2 hover:bg-hover">
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center text-low"
                >
                  <Glyph name="folder" className="size-[17px]" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-body">
                  {folder.name}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-low">
                  {items.length}
                </span>
              </summary>

              <div className="space-y-0.5 pl-2">
                {items.length === 0 ? (
                  <p className="px-3 py-1 text-[11px] text-low">Empty folder.</p>
                ) : (
                  items.map((chat) => (
                    <ChatRow
                      key={chat.id}
                      chat={chat}
                      active={chat.id === activeChatId}
                      folders={folders}
                    />
                  ))
                )}

                <details className="mt-0.5">
                  <summary className="cursor-pointer list-none px-3 py-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-low hover:text-hi">
                    settings
                  </summary>

                  <form action={renameFolder} className="mt-1 flex gap-1.5 px-2">
                    <input type="hidden" name="folderId" value={folder.id} />
                    <input
                      name="name"
                      defaultValue={folder.name}
                      required
                      maxLength={60}
                      aria-label={`Rename ${folder.name}`}
                      className="field min-w-0 flex-1 px-2 py-1 text-[11px]"
                    />
                    <SubmitButton className="btn px-2 py-1 text-[11px]" pendingText="Saving…">
                      Save
                    </SubmitButton>
                  </form>

                  <form action={deleteFolder} className="px-2 pb-1 pt-1.5">
                    <input type="hidden" name="folderId" value={folder.id} />
                    <SubmitButton
                      className="text-[11px] text-danger hover:underline"
                      pendingText="Deleting…"
                    >
                      Delete folder (chats kept)
                    </SubmitButton>
                  </form>
                </details>
              </div>
            </details>
          );
        })}

        <details className="mt-1">
          <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl px-3 py-2 text-[12.5px] text-mid hover:bg-hover hover:text-hi">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center text-low"
            >
              <Glyph name="plus" className="size-[17px]" />
            </span>
            New folder
          </summary>

          <form action={createFolder} className="mt-1 flex gap-1.5 px-2 pb-2">
            <input
              name="name"
              required
              maxLength={60}
              placeholder="Folder name"
              aria-label="New folder name"
              className="field min-w-0 flex-1 px-3 py-1.5 text-[11px]"
            />
            <SubmitButton className="btn px-3 py-1.5 text-[11px]" pendingText="Adding…">
              Add
            </SubmitButton>
          </form>
        </details>
      </nav>

      <div className="safe-bottom border-t border-line px-4 pb-4 pt-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-[11px] uppercase text-accent-text"
          >
            {initial}
          </span>

          <span
            className="min-w-0 flex-1 truncate text-[12px] text-mid"
            title={email}
          >
            {email}
          </span>

          <ThemeSwitcher variant="icon" />

          <form action="/auth/signout" method="post" className="shrink-0">
            <SubmitButton
              ariaLabel="Sign out"
              title="Sign out"
              pendingText=""
              className="rail-icon grid size-9 place-items-center rounded-full"
            >
              <Glyph name="signout" className="size-[18px]" />
            </SubmitButton>
          </form>
        </div>
      </div>
    </aside>
  );
}
