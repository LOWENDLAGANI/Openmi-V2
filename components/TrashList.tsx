"use client";

import Link from "next/link";
import { useOptimistic } from "react";

import { emptyTrash, purgeChat, restoreChat } from "@/app/chat/actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { SubmitButton } from "@/components/SubmitButton";
import { TRASH_RETENTION_DAYS } from "@/lib/trash";
import type { Chat } from "@/lib/types";

/**
 * The trash, emptied optimistically.
 *
 * Restoring, deleting one chat forever and emptying the bin are all removals
 * from this list, so each one is applied on the click and the list repaints if
 * the server refused. Restore redirects to the chat list, which is the one case
 * where the row leaving is the whole visible result.
 */

type Change = { kind: "one"; chatId: string } | { kind: "all" };

function apply(chats: Chat[], change: Change): Chat[] {
  return change.kind === "all"
    ? []
    : chats.filter((chat) => chat.id !== change.chatId);
}

export function TrashList({ chats }: { chats: Chat[] }) {
  const [rows, change] = useOptimistic<Chat[], Change>(chats, apply);

  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="eyebrow">trash</p>
        <h2 className="mt-2 text-[20px] font-semibold tracking-[-0.02em] text-hi">
          Trash is empty
        </h2>
        <Link href="/chat" className="btn mt-6">
          Back to chats
        </Link>
      </div>
    );
  }

  async function restore(chatId: string, formData: FormData) {
    change({ kind: "one", chatId });
    await restoreChat(formData);
  }

  async function purge(chatId: string, formData: FormData) {
    change({ kind: "one", chatId });
    await purgeChat(formData);
  }

  // The whole-bin action reads nothing from the form.
  async function empty() {
    change({ kind: "all" });
    await emptyTrash();
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <p className="mt-5 text-[11.5px] leading-relaxed text-low">
        Chats stay here until you restore them, delete them, or{" "}
        {TRASH_RETENTION_DAYS} days pass.
      </p>

      <ul className="panel mt-3 divide-y divide-line overflow-hidden">
        {rows.map((chat) => (
          <li
            key={chat.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-hi">{chat.title}</p>
              <p className="mt-0.5 font-mono text-[10.5px] text-low">
                deleted {chat.deleted_at?.slice(0, 10) ?? "—"}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <form action={(formData) => restore(chat.id, formData)}>
                <input type="hidden" name="chatId" value={chat.id} />
                <SubmitButton className="btn px-3 py-1 text-[11px]" optimisticText="Restored">
                  Restore
                </SubmitButton>
              </form>

              <form action={(formData) => purge(chat.id, formData)}>
                <input type="hidden" name="chatId" value={chat.id} />
                <ConfirmSubmit
                  message="Permanently delete this chat and its messages?"
                  optimisticText="Deleted"
                  className="rounded-full border border-danger/30 bg-danger/8 px-3 py-1 text-[11px] text-danger hover:opacity-90"
                >
                  Delete forever
                </ConfirmSubmit>
              </form>
            </div>
          </li>
        ))}
      </ul>

      <form action={empty} className="mt-4">
        <ConfirmSubmit
          message="Permanently delete every chat in the trash?"
          optimisticText="Emptied"
          className="btn px-4 py-1.5 text-[12px]"
        >
          Empty trash
        </ConfirmSubmit>
      </form>
    </div>
  );
}
