import Link from "next/link";
import { redirect } from "next/navigation";

import { connectGithub, disconnectGithub } from "@/app/github/actions";
import { ChatPanel } from "@/components/ChatPanel";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { DEW_PER_HOUR, LOW_BALANCE_DEW, formatDew, isLowBalance } from "@/lib/dew";
import { refillDailyDew } from "@/lib/dew/store";
import { RepoPicker } from "@/components/RepoPicker";
import { ReviewPanel } from "@/components/ReviewPanel";
import { Sidebar } from "@/components/Sidebar";
import { Workspace } from "@/components/Workspace";
import {
  MAX_PATH_INDEX,
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
import { loadChangesets } from "@/lib/changesets/store";
import { readConnection, readToken } from "@/lib/github/token";
import type { CodeSearch, FileView, RepoSummary } from "@/lib/github/types";
import { listMessages } from "@/lib/messages";
import { DEFAULT_MODEL, MODELS, isModelId } from "@/lib/models";
import { providersConfigured } from "@/lib/providers";
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
  view?: string;
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
        <span className="font-mono text-[12px] text-body">
          Contents: read and write
        </span>
        {", "}
        <span className="font-mono text-[12px] text-body">
          Pull requests: read and write
        </span>
        {", and "}
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
        <li>
          Writes happen only after you approve a changeset, and only on an
          openmi/agent/ branch.
        </li>
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

async function ChatView({ session, chat }: { session: SignedIn; chat: Chat }) {
  const [messages, changesets] = await Promise.all([
    listMessages(session.supabase, chat.id),
    loadChangesets(session.supabase, chat.id),
  ]);

  let repo: { fullName: string; branch: string; sha: string } | null = null;
  let validPaths: string[] = [];

  if (chat.repo_full_name && chat.repo_base_sha) {
    repo = {
      fullName: chat.repo_full_name,
      branch: chat.repo_branch ?? "",
      sha: chat.repo_base_sha,
    };

    // Citations are checked against the tree at the pinned commit, so a link
    // only appears when the path exists there. If this read fails, the
    // transcript still renders and citations stay plain text.
    try {
      const github = await readToken(session.supabase, session.user.id);
      if (github) {
        const tree = await getTree(github.token, chat.repo_full_name, chat.repo_base_sha);
        validPaths = tree.entries
          .filter((entry) => entry.type === "blob")
          .map((entry) => entry.path)
          .slice(0, MAX_PATH_INDEX);
      }
    } catch {
      validPaths = [];
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!repo && (
        <p className="mb-2 rounded-lg border border-line bg-raised px-3 py-2 text-[11.5px] text-mid">
          No repository attached, so answers have nothing to cite.{" "}
          <Link
            href={`/chat?chat=${chat.id}&view=repos`}
            className="text-accent underline-offset-2 hover:underline"
          >
            Pick one
          </Link>
          .
        </p>
      )}

      {changesets.length > 0 && (
        <div className="mb-2 max-h-[46vh] shrink-0 overflow-y-auto">
          <ReviewPanel
            changesets={changesets}
            chatId={chat.id}
            chatSha={chat.repo_base_sha}
          />
        </div>
      )}

      <div className="min-h-0 flex-1">
        <ChatPanel
          chatId={chat.id}
          repo={repo}
          models={MODELS}
          initialModel={isModelId(chat.model) ? chat.model : DEFAULT_MODEL}
          initialMessages={messages}
          validPaths={validPaths}
          pinnedPath={null}
          providerReady={providersConfigured()}
        />
      </div>
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

  // The daily allowance is settled before anything is rendered, so the chip
  // shows the balance the next turn will actually use.
  await refillDailyDew(supabase);

  const [foldersResult, chatsResult, connection, profileResult] = await Promise.all([
    supabase.from("folders").select("id, name, created_at").order("name"),
    supabase
      .from("chats")
      .select(
        "id, title, folder_id, repo_full_name, repo_branch, repo_base_sha, model, created_at, updated_at, deleted_at"
      )
      .order("updated_at", { ascending: false }),
    readConnection(supabase, user.id),
    supabase.from("profiles").select("dew_balance").eq("id", user.id).maybeSingle(),
  ]);

  const dewBalance = Number(
    (profileResult.data as { dew_balance?: number | string } | null)?.dew_balance ?? 0
  );

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

  // The workspace is a second view of the same chat, not a second page: a
  // citation opens the file beside the conversation, and the URL says which.
  const workspaceView = params.view === "files" || params.view === "repos";

  let body: React.ReactNode;
  if (trashView) {
    body = <TrashList chats={trashedChats} />;
  } else if (!connection) {
    body = <ConnectPanel />;
  } else if (activeChat && !workspaceView) {
    body = await ChatView({ session, chat: activeChat });
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
            {activeChat?.repo_full_name && activeChat.repo_base_sha && (
              <Link
                href={`/chat?chat=${activeChat.id}&repo=${encodeURIComponent(activeChat.repo_full_name)}&branch=${encodeURIComponent(activeChat.repo_branch ?? "")}&sha=${activeChat.repo_base_sha}&view=files`}
                className="text-[12px] text-mid hover:text-hi"
              >
                Files
              </Link>
            )}
            <Link
              href="/activity"
              title={`An hour of chat costs ${DEW_PER_HOUR} Dew. Low balance shows amber below ${LOW_BALANCE_DEW}.`}
              className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${
                isLowBalance(dewBalance)
                  ? "border-warn/40 bg-warn/10 text-warn"
                  : "border-line bg-chip text-low"
              }`}
            >
              Dew · {formatDew(dewBalance)}
            </Link>
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
