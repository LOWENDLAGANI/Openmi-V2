import Link from "next/link";
import { redirect } from "next/navigation";

import { connectGithub, disconnectGithub } from "@/app/github/actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { RepoPicker } from "@/components/RepoPicker";
import { Sidebar } from "@/components/Sidebar";
import { Workspace } from "@/components/Workspace";
import {
  describeGithubError,
  getFile,
  getRepo,
  getTree,
  isCommitSha,
  isRepoFullName,
  listBranches,
  listRepos,
  resolveBranchSha,
  searchCode,
} from "@/lib/github/read";
import { readConnection, readToken } from "@/lib/github/token";
import type { CodeSearch, FileView, RepoSummary } from "@/lib/github/types";
import { getSession } from "@/lib/session";
import type { Chat, Folder } from "@/lib/types";
import { createChat, emptyTrash, purgeChat, restoreChat } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Workspace — Openmi",
};

type SearchParams = {
  chat?: string;
  trash?: string;
  error?: string;
  connected?: string;
  repo?: string;
  branch?: string;
  sha?: string;
  dir?: string;
  path?: string;
  line?: string;
  q?: string;
};

type SignedIn = Extract<Awaited<ReturnType<typeof getSession>>, { state: "signed-in" }>;

function Panel({
  title,
  message,
  href,
  action,
}: {
  title: string;
  message: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h2 className="text-[15px] font-semibold text-hi">{title}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-mid">{message}</p>
      {href && action && (
        <Link
          href={href}
          className="mt-5 inline-block rounded-lg border border-line bg-card px-4 py-2 text-[13px] font-medium text-body hover:bg-hover"
        >
          {action}
        </Link>
      )}
    </div>
  );
}

function ConnectPanel() {
  return (
    <div className="mx-auto max-w-xl py-8">
      <h2 className="text-[15px] font-semibold text-hi">Connect GitHub</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-mid">
        Openmi reads repositories through the GitHub API with a token you
        provide. Create a fine-grained token with{" "}
        <span className="font-mono text-[12px] text-body">Contents: read</span>{" "}
        and{" "}
        <span className="font-mono text-[12px] text-body">Metadata: read</span>,
        then paste it once. It is sealed with AES-256-GCM before it is stored, and
        only its last four characters are ever shown again.
      </p>

      <form action={connectGithub} className="mt-4 space-y-2">
        <label
          htmlFor="github-token"
          className="block text-[12px] font-medium text-mid"
        >
          Personal access token
        </label>
        <input
          id="github-token"
          name="token"
          type="password"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="github_pat_… or ghp_…"
          className="w-full rounded-lg border border-line bg-card px-3 py-2 font-mono text-[12px] text-body placeholder:text-low"
        />
        <button className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-on-accent hover:opacity-90">
          Seal and connect
        </button>
      </form>

      <ul className="mt-5 space-y-1 text-[11.5px] leading-relaxed text-low">
        <li>The token is sent once over HTTPS and never returned to the browser.</li>
        <li>Read scopes are enough here; writes arrive in phase 6.</li>
        <li>Disconnecting deletes the sealed value immediately.</li>
      </ul>
    </div>
  );
}

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

async function loadWorkspace(token: string, params: SearchParams) {
  const fullName = params.repo ?? "";
  const repo = await getRepo(token, fullName);
  const branch =
    params.branch && params.branch.trim().length > 0
      ? params.branch.trim()
      : repo.defaultBranch;

  const pinned =
    params.sha && isCommitSha(params.sha)
      ? params.sha
      : await resolveBranchSha(token, fullName, branch);

  const [branches, tree] = await Promise.all([
    listBranches(token, fullName),
    getTree(token, fullName, pinned),
  ]);

  const path = params.path ?? null;
  const dir = params.dir ?? (path ? path.split("/").slice(0, -1).join("/") : "");

  let file: FileView | null = null;
  let fileError: string | null = null;
  if (path) {
    try {
      file = await getFile(token, fullName, pinned, path);
    } catch (error) {
      fileError = describeGithubError(error);
    }
  }

  const query = (params.q ?? "").trim();
  let search: CodeSearch | null = null;
  let searchError: string | null = null;
  if (query.length >= 2) {
    try {
      const result = await searchCode(token, fullName, pinned, query);
      search = { query, ...result };
    } catch (error) {
      searchError = describeGithubError(error);
    }
  }

  const line = params.line ? Number.parseInt(params.line, 10) || null : null;

  return {
    repo,
    branch,
    branches,
    sha: pinned,
    tree,
    dir,
    path,
    line,
    file,
    fileError,
    search,
    searchError,
  };
}

async function RepoSurface({
  session,
  params,
  chat,
}: {
  session: SignedIn;
  params: SearchParams;
  chat: Chat | null;
}) {
  let github: Awaited<ReturnType<typeof readToken>> = null;
  try {
    github = await readToken(session.supabase, session.user.id);
  } catch (error) {
    return (
      <Panel
        title="GitHub needs a fresh token"
        message={describeGithubError(error)}
        href="/chat"
        action="Reconnect"
      />
    );
  }

  if (!github) return <ConnectPanel />;

  if (!params.repo) {
    let repos: RepoSummary[] = [];
    let error: string | null = null;
    try {
      repos = await listRepos(github.token);
    } catch (caught) {
      error = describeGithubError(caught);
    }

    return (
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-hi">Pick a repository</h2>
            <p className="mt-1 text-[12px] text-mid">
              Connected as{" "}
              <span className="font-mono text-body">@{github.connection.login}</span>
              {" · "}
              {github.connection.scopes.length > 0
                ? github.connection.scopes.join(", ")
                : "fine-grained token"}
              {" · ends "}
              <span className="font-mono text-body">
                {github.connection.lastFour}
              </span>
            </p>
          </div>

          <form action={disconnectGithub}>
            <ConfirmSubmit
              message="Disconnect GitHub? The sealed token is deleted and the workspace stops reading repositories."
              className="rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] text-mid hover:text-hi"
            >
              Disconnect
            </ConfirmSubmit>
          </form>
        </div>

        <p className="mt-4 text-[13px] leading-relaxed text-mid">
          A chat is anchored to one repository, so a proposed diff always has
          exactly one base. Nothing is cloned; every read is an API call at the
          commit shown in the workspace.
        </p>

        {error ? (
          <Panel title="GitHub could not list repositories" message={error} />
        ) : repos.length === 0 ? (
          <Panel
            title="No readable repositories"
            message="This token cannot read any repository. Check its repository access, or make a new token."
          />
        ) : (
          <div className="mt-4">
            <RepoPicker repos={repos} chatId={chat?.id} />
          </div>
        )}
      </div>
    );
  }

  if (!isRepoFullName(params.repo)) {
    return (
      <Panel
        title="That repository name is not valid"
        message="Repository names look like owner/name."
        href="/chat"
        action="Pick another repository"
      />
    );
  }

  try {
    const workspace = await loadWorkspace(github.token, params);
    return <Workspace {...workspace} chatId={chat?.id} />;
  } catch (error) {
    return (
      <Panel
        title="GitHub could not read that repository"
        message={describeGithubError(error)}
        href="/chat"
        action="Pick another repository"
      />
    );
  }
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

  const [foldersResult, chatsResult, connection] = await Promise.all([
    supabase.from("folders").select("id, name, created_at").order("name"),
    supabase
      .from("chats")
      .select(
        "id, title, folder_id, repo_full_name, repo_branch, repo_base_sha, model, created_at, updated_at, deleted_at"
      )
      .order("updated_at", { ascending: false }),
    readConnection(supabase, user.id),
  ]);

  const folders = (foldersResult.data ?? []) as Folder[];
  const allChats = (chatsResult.data ?? []) as Chat[];

  const liveChats = allChats.filter((chat) => !chat.deleted_at);
  const trashedChats = allChats.filter((chat) => chat.deleted_at);
  const activeChat = params.chat
    ? liveChats.find((chat) => chat.id === params.chat) ?? null
    : null;

  const heading = trashView
    ? "Deleted chats"
    : params.repo
      ? params.repo
      : activeChat
        ? activeChat.title
        : connection
          ? "Pick a repository"
          : "Connect GitHub";

  const eyebrow = trashView ? "Trash" : params.repo ? "Workspace" : "Chats";

  let body: React.ReactNode;
  if (trashView) {
    body = <TrashList chats={trashedChats} />;
  } else if (!connection) {
    body = <ConnectPanel />;
  } else {
    body = await RepoSurface({ session, params, chat: activeChat });
  }

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
              {eyebrow}
            </p>
            <h1 className="truncate text-[15px] font-semibold text-hi">
              {heading}
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

        {params.connected && !params.error && (
          <p className="border-b border-line bg-raised px-5 py-2 text-[12px] text-mid">
            GitHub connected as{" "}
            <span className="font-mono text-hi">{params.connected}</span>.
          </p>
        )}

        <div className="flex-1 overflow-y-auto p-5">
          {body}

          {!trashView && !params.repo && !activeChat && !connection && (
            <form action={createChat} className="mx-auto mt-6 w-fit">
              <button className="text-[12px] text-mid underline-offset-2 hover:text-hi hover:underline">
                Start a chat without a repository
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
