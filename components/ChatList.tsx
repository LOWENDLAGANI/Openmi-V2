"use client";

import { Folder as FolderIcon, MoreHorizontal, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useOptimistic, useRef, useState } from "react";

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
  onOpen,
}: {
  chat: Chat;
  active: boolean;
  folders: Folder[];
  onChange: (change: Change) => void;
  onOpen: (chatId: string) => void;
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
      className="rail-row group relative flex items-center rounded-lg"
    >
      <Link
        href={`/chat?chat=${chat.id}`}
        aria-current={active ? "page" : undefined}
        onClick={() => onOpen(chat.id)}
        title={chat.title}
        className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2.5 pr-1"
      >
        <span
          className={`min-w-0 flex-1 truncate text-[13px] ${
            active ? "font-medium text-hi" : ""
          }`}
        >
          {chat.title}
        </span>
      </Link>

      <details className="relative shrink-0 pr-1">
        <summary
          className="grid size-6 cursor-pointer list-none place-items-center rounded-md text-low opacity-0 transition-opacity hover:bg-card hover:text-hi focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
          aria-label={`Options for ${chat.title}`}
        >
          <MoreHorizontal aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
        </summary>
        <div className="animate-pop absolute right-0 top-full z-30 mt-1 w-60 rounded-xl border border-line-strong bg-card p-2 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.35)]">
          <form action={rename} className="flex gap-1.5">
            <input type="hidden" name="chatId" value={chat.id} />
            <input
              name="title"
              defaultValue={chat.title}
              required
              maxLength={60}
              aria-label={`Rename ${chat.title}`}
              className="field min-w-0 flex-1 px-2 py-1 text-[11.5px]"
            />
            <SubmitButton className="btn px-2.5 py-1 text-[11px]" optimisticText="Renamed">
              Rename
            </SubmitButton>
          </form>

          <form action={move} className="mt-2 flex gap-1.5 border-t border-line pt-2">
            <input type="hidden" name="chatId" value={chat.id} />
            <select
              name="folderId"
              defaultValue={chat.folder_id ?? ""}
              aria-label="Folder"
              className="field min-w-0 flex-1 px-2 py-1 text-[11.5px]"
            >
              <option value="">No folder</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
            <SubmitButton className="btn px-2.5 py-1 text-[11px]" optimisticText="Moved">
              Move
            </SubmitButton>
          </form>

          <form action={trash} className="mt-2 border-t border-line pt-2">
            <input type="hidden" name="chatId" value={chat.id} />
            <SubmitButton
              className="w-full rounded-md px-2 py-1.5 text-left text-[11.5px] font-medium text-danger hover:bg-danger/10"
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

  const [opening, setOpening] = useState<string | null>(null);
  const openingTimer = useRef<number | null>(null);

  useEffect(() => {
    if (openingTimer.current !== null) {
      window.clearTimeout(openingTimer.current);
      openingTimer.current = null;
    }
    setOpening(null);
  }, [activeChatId]);

  useEffect(
    () => () => {
      if (openingTimer.current !== null) window.clearTimeout(openingTimer.current);
    },
    []
  );

  function open(chatId: string) {
    setOpening(chatId);

    if (openingTimer.current !== null) window.clearTimeout(openingTimer.current);
    openingTimer.current = window.setTimeout(() => {
      openingTimer.current = null;
      setOpening(null);
    }, 10_000);
  }

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
      className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-2.5"
    >
      <p className="px-2.5 pb-1.5 text-[11px] font-medium text-low">
        Recent threads
      </p>

      {ungrouped.length === 0 ? (
        <p className="px-2.5 pb-2 text-[12px] leading-relaxed text-low">
          No threads yet.
        </p>
      ) : (
        <div className="space-y-0.5">
          {ungrouped.map((chat) => (
            <ChatRow
              key={chat.id}
              chat={chat}
              active={chat.id === activeChatId || chat.id === opening}
              folders={board.folders}
              onChange={change}
              onOpen={open}
            />
          ))}
        </div>
      )}

      {board.folders.map((folder) => {
        const items = inFolder(folder.id);

        return (
          <details key={folder.id} open className="mt-2">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-hover">
              <FolderIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 text-low"
                strokeWidth={1.75}
              />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-body">
                {folder.name}
              </span>
              <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-low">
                {items.length}
              </span>
            </summary>

            <div className="mt-0.5 space-y-0.5 pl-2">
              {items.length === 0 ? (
                <p className="px-2.5 py-1 text-[11.5px] text-low">Empty folder.</p>
              ) : (
                items.map((chat) => (
                  <ChatRow
                    key={chat.id}
                    chat={chat}
                    active={chat.id === activeChatId || chat.id === opening}
                    folders={board.folders}
                    onChange={change}
                    onOpen={open}
                  />
                ))
              )}

              <details className="mt-0.5">
                <summary className="cursor-pointer list-none px-2.5 py-1 text-[11px] text-low hover:text-hi">
                  Folder settings
                </summary>

                <form action={renameFolder} className="mt-1 flex gap-1.5 px-2">
                  <input type="hidden" name="folderId" value={folder.id} />
                  <input
                    name="name"
                    defaultValue={folder.name}
                    required
                    maxLength={60}
                    aria-label={`Rename ${folder.name}`}
                    className="field min-w-0 flex-1 px-2 py-1 text-[11.5px]"
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

      <details className="mt-2">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-mid hover:bg-hover hover:text-hi">
          <Plus aria-hidden="true" className="size-3.5 shrink-0 text-low" strokeWidth={1.75} />
          New folder
        </summary>

        <form action={createFolder} className="mt-1.5 flex gap-1.5 px-2 pb-2">
          <input
            name="name"
            required
            maxLength={60}
            placeholder="Folder name"
            aria-label="New folder name"
            className="field min-w-0 flex-1 px-2.5 py-1.5 text-[11.5px]"
          />
          <SubmitButton className="btn px-2.5 py-1.5 text-[11.5px]" optimisticText="Added">
            Add
          </SubmitButton>
        </form>
      </details>
    </nav>
  );
}
