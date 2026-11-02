import Link from "next/link";

import { Brand } from "@/components/Brand";
import type { Chat, Folder } from "@/lib/types";
import {
  createChat,
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
      className={`flex items-center gap-0.5 rounded-lg ${
        active ? "bg-chip" : "hover:bg-hover"
      }`}
    >
      <Link
        href={`/chat?chat=${chat.id}`}
        aria-current={active ? "page" : undefined}
        className={`min-w-0 flex-1 truncate px-2 py-1.5 text-[12.5px] ${
          active ? "font-medium text-hi" : "text-body"
        }`}
      >
        {chat.title}
      </Link>

      <details className="shrink-0">
        <summary
          className="cursor-pointer list-none px-1.5 py-1 text-[11px] text-low hover:text-hi"
          aria-label={`Options for ${chat.title}`}
        >
          ⋯
        </summary>
        <div className="mt-1 w-52 rounded-lg border border-line bg-card p-2">
          <form action={moveChatToFolder} className="flex gap-1">
            <input type="hidden" name="chatId" value={chat.id} />
            <select
              name="folderId"
              defaultValue={chat.folder_id ?? ""}
              aria-label="Folder"
              className="min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 py-1 text-[11px] text-body"
            >
              <option value="">No folder</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
            <button className="rounded border border-line bg-chip px-1.5 py-1 text-[11px] text-mid hover:text-hi">
              Move
            </button>
          </form>

          <form action={trashChat} className="mt-1.5 border-t border-line pt-1.5">
            <input type="hidden" name="chatId" value={chat.id} />
            <button className="w-full text-left text-[11px] text-mid hover:text-hi">
              Move to trash
            </button>
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
}: {
  email: string;
  folders: Folder[];
  chats: Chat[];
  activeChatId?: string;
  trashView: boolean;
  trashedCount: number;
}) {
  const ungrouped = chats.filter((chat) => !chat.folder_id);
  const inFolder = (folderId: string) =>
    chats.filter((chat) => chat.folder_id === folderId);

  return (
    <aside className="flex h-full min-h-0 flex-col gap-3 border-b border-line bg-raised p-3 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between px-1">
        <Link href="/" aria-label="Openmi home">
          <Brand compact />
        </Link>
      </div>

      <form action={createChat}>
        <button className="w-full rounded-lg border border-line bg-chip px-3 py-2 text-left text-[13px] font-medium text-body hover:bg-hover">
          + New chat
        </button>
      </form>

      <nav aria-label="Chats" className="min-h-0 flex-1 overflow-y-auto pr-1">
        <p className="px-2 pb-1 pt-1 text-[10px] uppercase tracking-[0.14em] text-low">
          Chats
        </p>

        {ungrouped.length === 0 ? (
          <p className="px-2 py-1 text-[11px] text-low">No chats outside folders.</p>
        ) : (
          ungrouped.map((chat) => (
            <ChatRow
              key={chat.id}
              chat={chat}
              active={chat.id === activeChatId}
              folders={folders}
            />
          ))
        )}

        {folders.map((folder) => {
          const items = inFolder(folder.id);
          return (
            <details key={folder.id} open className="mt-1">
              <summary className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-[12px] text-mid hover:bg-hover">
                <span className="truncate">{folder.name}</span>
                <span className="ml-2 font-mono text-[10px] text-low">
                  {items.length}
                </span>
              </summary>

              <div className="ml-1.5 border-l border-line pl-1.5">
                {items.length === 0 ? (
                  <p className="px-2 py-1 text-[11px] text-low">Empty folder.</p>
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
                  <summary className="cursor-pointer px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-low">
                    Folder options
                  </summary>

                  <form action={renameFolder} className="mt-1 flex gap-1 px-1">
                    <input type="hidden" name="folderId" value={folder.id} />
                    <input
                      name="name"
                      defaultValue={folder.name}
                      required
                      maxLength={60}
                      aria-label={`Rename ${folder.name}`}
                      className="min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 py-1 text-[11px] text-body"
                    />
                    <button className="rounded border border-line bg-chip px-1.5 py-1 text-[11px] text-mid hover:text-hi">
                      Save
                    </button>
                  </form>

                  <form action={deleteFolder} className="px-1 pt-1">
                    <input type="hidden" name="folderId" value={folder.id} />
                    <button className="text-[11px] text-danger hover:underline">
                      Delete folder (chats kept)
                    </button>
                  </form>
                </details>
              </div>
            </details>
          );
        })}

        <form action={createFolder} className="mt-3 flex gap-1.5 px-1">
          <input
            name="name"
            required
            maxLength={60}
            placeholder="New folder"
            aria-label="New folder name"
            className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2 py-1.5 text-[11px] text-body placeholder:text-low"
          />
          <button className="rounded-lg border border-line bg-chip px-2 py-1.5 text-[11px] text-mid hover:text-hi">
            Add
          </button>
        </form>
      </nav>

      <div className="border-t border-line pt-3">
        <Link
          href="/activity"
          className="block rounded-lg px-2 py-1.5 text-[12px] text-mid hover:bg-hover hover:text-hi"
        >
          Dew &amp; activity
        </Link>

        <Link
          href={trashView ? "/chat" : "/chat?trash=1"}
          className="block rounded-lg px-2 py-1.5 text-[12px] text-mid hover:bg-hover hover:text-hi"
        >
          {trashView ? "Back to chats" : `Trash · ${trashedCount}`}
        </Link>

        <p className="mt-2 truncate px-2 text-[11px] text-low" title={email}>
          {email}
        </p>

        <form action="/auth/signout" method="post">
          <button className="mt-1 px-2 py-1 text-[11px] text-mid hover:text-hi">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
