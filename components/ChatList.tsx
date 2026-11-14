"use client";

import Link from "next/link";
import { useOptimistic } from "react";

import {
  createFolder,
  deleteFolder,
  moveChatToFolder,
  renameChat,
  renameFolder,
  trashChat,
} from "@/app/chat/actions";
import { SubmitButton } from "@/components/SubmitButton";
import type { Chat, Folder } from "@/lib/types";

/**
 * The chat list, painted before the server agrees.
 *
 * Trashing a chat, moving it to a folder and deleting a folder are all list
 * edits the reader already decided on, so the list makes them on the click: the
 * row leaves, the chat changes group, the folder's chats fall back to ungrouped.
 * `useOptimistic` ties every guess to the form action that produced it — if the
 * action throws or the guard refuses it, the guess is discarded and the list
 * paints the server's version again. That is the rollback, and the reader never
 * sat through a round trip to watch a row disappear.
 *
 * Creating a folder is the one edit left server-first: its name is settled
 * locally but its id is not, so a guessed group could not hold the folder's own
 * settings forms.
 */

type Change =
  | { kind: "trash"; chatId: string }
  | { kind: "move"; chatId: string; folderId: string | null }
  | { kind: "rename"; chatId: string; title: string }
  | { kind: "delete-folder"; folderId: string };

type Board = { chats: Chat[]; folders: Folder[] };

function apply(board: Board, change: Change): Board {
  if (change.kind === "trash") {
    return {
      ...board,
      chats: board.chats.filter((chat) => chat.id !== change.chatId),
    };
  }

  if (change.kind === "move") {
    return {
      ...board,
      chats: board.chats.map((chat) =>
        chat.id === change.chatId
          ? { ...chat, folder_id: change.folderId }
          : chat
      ),
    };
  }

  if (change.kind === "rename") {
    return {
      ...board,
      chats: board.chats.map((chat) =>
        chat.id === change.chatId ? { ...chat, title: change.title } : chat
      ),
    };
  }

  // Deleting a folder keeps its chats; they are ungrouped, not removed.
  return {
    folders: board.folders.filter((folder) => folder.id !== change.folderId),
    chats: board.chats.map((chat) =>
      chat.folder_id === change.folderId ? { ...chat, folder_id: null } : chat
    ),
  };
}

function ChatRow({
  chat,
  active,
  folders,
  onChange,
}: {
  chat: Chat;
  active: boolean;
  folders: Folder[];
  onChange: (change: Change) => void;
}) {
  async function move(formData: FormData) {
    const folderId = String(formData.get("folderId") ?? "");
    onChange({ kind: "move", chatId: chat.id, folderId: folderId || null });
    await moveChatToFolder(formData);
  }

  async function trash(formData: FormData) {
    onChange({ kind: "trash", chatId: chat.id });
    await trashChat(formData);
  }

  async function rename(formData: FormData) {
    const title = String(formData.get("title") ?? "").trim();
    if (title.length > 0) {
      onChange({ kind: "rename", chatId: chat.id, title });
    }
    await renameChat(formData);
  }

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
          <form action={rename} className="flex gap-1.5">
            <input type="hidden" name="chatId" value={chat.id} />
            <input
              name="title"
              defaultValue={chat.title}
              required
              maxLength={60}
              aria-label={`Rename ${chat.title}`}
              className="field min-w-0 flex-1 px-2 py-1 text-[11px]"
            />
            <SubmitButton className="btn px-2 py-1 text-[11px]" optimisticText="Renamed">
              Rename
            </SubmitButton>
          </form>

          <form action={move} className="mt-1.5 flex gap-1.5 border-t border-line pt-1.5">
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
            <SubmitButton className="btn px-2 py-1 text-[11px]" optimisticText="Moved">
              Move
            </SubmitButton>
          </form>

          <form action={trash} className="mt-1.5 border-t border-line pt-1.5">
            <input type="hidden" name="chatId" value={chat.id} />
            <SubmitButton
              className="w-full rounded-lg px-2 py-1.5 text-left text-[11px] text-mid hover:bg-hover hover:text-hi"
              optimisticText="Trashed"
            >
              Move to trash
            </SubmitButton>
          </form>
        </div>
      </details>
    </div>
  );
}

export function ChatList({
  chats,
  folders,
  activeChatId,
}: {
  chats: Chat[];
  folders: Folder[];
  activeChatId?: string;
}) {
  const [board, change] = useOptimistic<Board, Change>({ chats, folders }, apply);

  const ungrouped = board.chats.filter((chat) => !chat.folder_id);
  const inFolder = (folderId: string) =>
    board.chats.filter((chat) => chat.folder_id === folderId);

  async function removeFolder(folderId: string, formData: FormData) {
    change({ kind: "delete-folder", folderId });
    await deleteFolder(formData);
  }

  return (
    <nav
      aria-label="Chats"
      className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-3"
    >
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
              folders={board.folders}
              onChange={change}
            />
          ))}
        </div>
      )}

      {board.folders.map((folder) => {
        const items = inFolder(folder.id);

        return (
          <details key={folder.id} open className="mt-1">
            <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl px-3 py-2 hover:bg-hover">
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center text-low"
              >
                <Glyph name="folder" />
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
                    folders={board.folders}
                    onChange={change}
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
                  <SubmitButton className="btn px-2 py-1 text-[11px]" optimisticText="Saved">
                    Save
                  </SubmitButton>
                </form>

                <form
                  action={(formData) => removeFolder(folder.id, formData)}
                  className="px-2 pb-1 pt-1.5"
                >
                  <input type="hidden" name="folderId" value={folder.id} />
                  <SubmitButton
                    className="text-[11px] text-danger hover:underline"
                    optimisticText="Deleted"
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
            <Glyph name="plus" />
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
          <SubmitButton className="btn px-3 py-1.5 text-[11px]" optimisticText="Added">
            Add
          </SubmitButton>
        </form>
      </details>
    </nav>
  );
}

/** The two glyphs this list draws; the rail owns the rest. */
function Glyph({ name }: { name: "folder" | "plus" }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className="size-[17px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "folder" ? (
        <path d="M3.8 7.6a2 2 0 0 1 2-2h3.1l1.8 2.1h7.5a2 2 0 0 1 2 2v6.7a2 2 0 0 1-2 2H5.8a2 2 0 0 1-2-2Z" />
      ) : (
        <path d="M12 5.5v13M5.5 12h13" />
      )}
    </svg>
  );
}
