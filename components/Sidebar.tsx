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
      className={`group relative flex items-center rounded-xl pr-1 ${
        active ? "bg-elevated" : "hover:bg-hover"
      }`}
    >
      <span
        aria-hidden="true"
        className={`ml-3 size-1.5 shrink-0 rounded-full ${
          active ? "bg-accent" : "bg-line-strong"
        }`}
      />

      <Link
        href={`/chat?chat=${chat.id}`}
        aria-current={active ? "page" : undefined}
        title={chat.title}
        className={`min-w-0 flex-1 truncate px-2.5 py-2 text-[12.5px] ${
          active
            ? "font-semibold text-hi"
            : "text-mid group-hover:text-hi"
        }`}
      >
        {chat.title}
      </Link>

      <details className="relative shrink-0">
        <summary
          className="grid size-7 cursor-pointer list-none place-items-center rounded-full text-[14px] leading-none text-low opacity-0 transition-opacity hover:bg-canvas hover:text-hi focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
          aria-label={`Options for ${chat.title}`}
        >
          ⋯
        </summary>
        <div className="animate-pop absolute right-0 top-full z-30 mt-1 w-56 rounded-2xl border border-line bg-card p-2 shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
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

  return (
    <aside className="flex h-full min-h-0 flex-col bg-raised md:border-r md:border-line">
      <div className="flex items-center justify-between gap-2 px-5 pb-4 pt-5">
        <Link href="/" aria-label="Openmi home" className="lift">
          <span className="flex items-center gap-2.5">
            <OpenmiMark size={36} />
            <span className="flex flex-col leading-none">
              <span className="text-[24px] font-semibold tracking-[-0.045em] text-hi">
                openmi
              </span>
              <span className="mt-1 text-[10px] tracking-[0.02em] text-low">
                by Minetallest
              </span>
            </span>
          </span>
        </Link>
        <Link href="/setup" className="eyebrow hover:text-hi">
          setup
        </Link>
      </div>

      <div className="space-y-2 px-3">
        <Link
          href={newChatHref}
          className="lift flex w-full items-center justify-center gap-2 rounded-2xl bg-elevated py-2.5 text-[13px] font-medium text-hi hover:bg-hover"
        >
          <span aria-hidden="true" className="text-[15px] leading-none">
            +
          </span>
          New chat
        </Link>

        <SearchLauncher />

        <p className="rounded-full border border-line px-3 py-1.5 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-low">
          one repo · one chat
        </p>
      </div>

      <nav aria-label="Chats" className="mt-6 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <p className="eyebrow px-3 pb-2">Chats</p>

        {ungrouped.length === 0 ? (
          <p className="px-3 pb-2 text-[11.5px] leading-relaxed text-low">
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
            <details key={folder.id} open className="mt-5">
              <summary className="eyebrow flex cursor-pointer list-none items-center gap-2 rounded-full px-3 py-1.5 hover:text-hi">
                <span className="min-w-0 truncate">{folder.name}</span>
                <span className="ml-auto font-mono text-[10px] text-low">
                  {items.length}
                </span>
              </summary>

              <div className="mt-0.5 space-y-0.5 border-l border-line pl-1.5">
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

                <details className="mt-1">
                  <summary className="eyebrow cursor-pointer list-none px-3 py-1 hover:text-hi">
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

                  <form action={deleteFolder} className="px-2 pt-1.5 pb-1">
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

        <form action={createFolder} className="mt-6 flex gap-1.5 px-1">
          <input
            name="name"
            required
            maxLength={60}
            placeholder="New folder"
            aria-label="New folder name"
            className="field min-w-0 flex-1 px-3 py-1.5 text-[11px]"
          />
          <SubmitButton className="btn px-3 py-1.5 text-[11px]" pendingText="Adding…">
            Add
          </SubmitButton>
        </form>
      </nav>

      <div className="border-t border-line px-2 py-3">
        <ThemeSwitcher className="mb-2 w-full justify-between" />

        <Link
          href="/pay"
          className="flex items-center justify-between rounded-full px-3 py-2 text-[12px] text-mid hover:bg-hover hover:text-hi"
        >
          Plans &amp; receipts
          <span aria-hidden="true" className="text-low">
            ↗
          </span>
        </Link>

        <Link
          href="/activity"
          className="flex items-center justify-between rounded-full px-3 py-2 text-[12px] text-mid hover:bg-hover hover:text-hi"
        >
          Dew &amp; activity
          <span aria-hidden="true" className="text-low">
            ↗
          </span>
        </Link>

        <Link
          href={trashView ? "/chat" : "/chat?trash=1"}
          className="flex items-center justify-between rounded-full px-3 py-2 text-[12px] text-mid hover:bg-hover hover:text-hi"
        >
          {trashView ? "Back to chats" : "Trash"}
          <span className="font-mono text-[10px] text-low">{trashedCount}</span>
        </Link>

        <div className="mt-2 flex items-center justify-between gap-2 border-t border-line px-3 pt-3">
          <p className="min-w-0 truncate text-[11px] text-low" title={email}>
            {email}
          </p>
          <form action="/auth/signout" method="post">
            <SubmitButton
              className="text-[11px] text-mid hover:text-hi"
              pendingText="Signing out…"
            >
              Sign out
            </SubmitButton>
          </form>
        </div>
      </div>
    </aside>
  );
}
