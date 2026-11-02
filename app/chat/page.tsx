import Link from "next/link";
import { redirect } from "next/navigation";

import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { Sidebar } from "@/components/Sidebar";
import { getSession } from "@/lib/session";
import type { Chat, Folder } from "@/lib/types";
import {
  createChat,
  emptyTrash,
  purgeChat,
  restoreChat,
} from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Workspace — Openmi",
};

type SearchParams = { chat?: string; trash?: string; error?: string };

function TrashList({ chats }: { chats: Chat[] }) {
  if (chats.length === 0) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h2 className="text-[15px] font-semibold text-hi">Trash is empty</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          Deleted chats wait here until you purge them. Restoring one puts it
          back in the sidebar, in its folder.
        </p>
        <Link
          href="/chat"
          className="mt-5 inline-block rounded-lg border border-line bg-card px-4 py-2 text-[13px] font-medium text-body hover:bg-hover"
        >
          Back to chats
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-[13px] leading-relaxed text-mid">
        Deleted chats keep their messages and folder until you purge them.
        Purging is permanent.
      </p>

      <ul className="mt-4 space-y-2">
        {chats.map((chat) => (
          <li
            key={chat.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-hi">
                {chat.title}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-low">
                deleted {chat.deleted_at?.slice(0, 10) ?? "—"}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <form action={restoreChat}>
                <input type="hidden" name="chatId" value={chat.id} />
                <button className="rounded-lg border border-line bg-raised px-2.5 py-1 text-[11px] text-mid hover:text-hi">
                  Restore
                </button>
              </form>

              <form action={purgeChat}>
                <input type="hidden" name="chatId" value={chat.id} />
                <ConfirmSubmit
                  message="Permanently delete this chat and its messages?"
                  className="rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-1 text-[11px] text-danger hover:opacity-90"
                >
                  Delete forever
                </ConfirmSubmit>
              </form>
            </div>
          </li>
        ))}
      </ul>

      <form action={emptyTrash} className="mt-4">
        <ConfirmSubmit
          message="Permanently delete every chat in the trash?"
          className="rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] text-mid hover:text-hi"
        >
          Empty trash
        </ConfirmSubmit>
      </form>
    </div>
  );
}

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const session = await getSession();

  if (session.state === "signed-out") {
    redirect("/login?next=%2Fchat");
  }

  if (session.state === "unconfigured") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
        <h1 className="text-xl font-semibold text-hi">
          The workspace needs Supabase
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          Chats, folders and the trash live in Postgres behind row-level
          security. Without a project configured there is nowhere to put them.
        </p>
        <Link
          href="/setup"
          className="mt-5 inline-block w-fit rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-on-accent"
        >
          Open setup
        </Link>
      </main>
    );
  }

  const { supabase, user } = session;
  const trashView = params.trash === "1";

  const [foldersResult, chatsResult] = await Promise.all([
    supabase.from("folders").select("id, name, created_at").order("name"),
    supabase
      .from("chats")
      .select(
        "id, title, folder_id, repo_full_name, model, created_at, updated_at, deleted_at"
      )
      .order("updated_at", { ascending: false }),
  ]);

  const folders = (foldersResult.data ?? []) as Folder[];
  const allChats = (chatsResult.data ?? []) as Chat[];

  const liveChats = allChats.filter((chat) => !chat.deleted_at);
  const trashedChats = allChats.filter((chat) => chat.deleted_at);
  const activeChat = params.chat
    ? liveChats.find((chat) => chat.id === params.chat) ?? null
    : null;

  return (
    <div className="md:grid md:h-dvh md:grid-cols-[280px_1fr]">
      <Sidebar
        email={user.email ?? "signed in"}
        folders={folders}
        chats={liveChats}
        activeChatId={activeChat?.id}
        trashView={trashView}
        trashedCount={trashedChats.length}
      />

      <main className="flex min-h-dvh flex-col md:min-h-0">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-low">
              {trashView ? "Trash" : activeChat ? "Chat" : "Workspace"}
            </p>
            <h1 className="truncate text-[15px] font-semibold text-hi">
              {trashView ? "Deleted chats" : activeChat?.title ?? "New chat"}
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <span
              title="Billing arrives in phase 7"
              className="rounded-full border border-line bg-chip px-2.5 py-1 font-mono text-[11px] text-low"
            >
              Dew · —
            </span>
            <Link href="/setup" className="text-[12px] text-mid hover:text-hi">
              Setup
            </Link>
          </div>
        </header>

        {params.error && (
          <p
            role="alert"
            className="border-b border-danger/30 bg-danger/10 px-5 py-2 text-[12px] text-danger"
          >
            {params.error}
          </p>
        )}

        <div className="flex-1 overflow-y-auto p-5">
          {trashView ? (
            <TrashList chats={trashedChats} />
          ) : activeChat ? (
            <section className="mx-auto max-w-xl py-16">
              <h2 className="text-[15px] font-semibold text-hi">
                {activeChat.title}
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-mid">
                This chat exists, belongs to you, and has a folder, a model and a
                soft-delete state. The conversation itself arrives in phase 3,
                when the agent can read the repository it is anchored to.
              </p>

              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-line bg-card p-4">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-low">
                    Model
                  </dt>
                  <dd className="mt-1 text-[13px] text-body">
                    {activeChat.model}
                  </dd>
                </div>
                <div className="rounded-xl border border-line bg-card p-4">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-low">
                    Repository
                  </dt>
                  <dd className="mt-1 text-[13px] text-body">
                    {activeChat.repo_full_name ?? "Not attached yet"}
                  </dd>
                </div>
              </dl>
            </section>
          ) : (
            <section className="mx-auto max-w-md py-16 text-center">
              <h2 className="text-[15px] font-semibold text-hi">
                No chat selected
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-mid">
                Chats keep their folder, repository and review history. Start one
                now and it will be waiting when the agent lands.
              </p>
              <form action={createChat} className="mt-5">
                <button className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-on-accent hover:opacity-90">
                  Start a chat
                </button>
              </form>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
