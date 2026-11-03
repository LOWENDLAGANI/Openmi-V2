import Link from "next/link";
import { redirect } from "next/navigation";

import { connectGithub, disconnectGithub } from "@/app/github/actions";
import { AppShell } from "@/components/AppShell";
import { ChatPanel } from "@/components/ChatPanel";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { SubmitButton } from "@/components/SubmitButton";
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
import { DEFAULT_MODEL, hasModel } from "@/lib/models";
import { modelCatalogue, providersConfigured } from "@/lib/providers";
import { getSession } from "@/lib/session";
import type { Chat, Folder } from "@/lib/types";
import { emptyTrash, purgeChat, restoreChat } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Workspace — Openmi",
};

type SearchParams = {
  chat?: string;
  new?: string;
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
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="eyebrow">stop</p>
      <h2 className="mt-2 text-[19px] font-semibold tracking-[-0.02em] text-hi">{title}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-mid">{message}</p>
      {href && action && (
        <Link href={href} className="btn mt-6">
          {action}
        </Link>
      )}
    </div>
  );
}

function ConnectPanel() {
  return (
    <div className="mx-auto w-full max-w-xl py-8">
      <p className="eyebrow">step one</p>
      <h2 className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-hi">
        Connect GitHub
      </h2>
      <p className="mt-3 text-[13.5px] leading-relaxed text-mid">
        Openmi reads repositories through the GitHub API with a token you
        provide. Create a fine-grained token with{" "}
        <span className="font-mono text-[12.5px] text-body">
          Contents: read and write
        </span>
        {", "}
        <span className="font-mono text-[12.5px] text-body">
          Pull requests: read and write
        </span>
        {", and "}
        <span className="font-mono text-[12.5px] text-body">Metadata: read</span>,
        then paste it once. It is sealed with AES-256-GCM before it is stored, and
        only its last four characters are ever shown again.
      </p>

      <form action={connectGithub} className="panel mt-6 space-y-3 p-4">
        <label htmlFor="github-token" className="eyebrow block px-1">
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
          className="field py-2.5 font-mono text-[12px]"
        />
        <SubmitButton
          className="btn btn-primary w-full py-2.5 text-[13px]"
          pendingText="Connecting to GitHub…"
        >
          Seal and connect
        </SubmitButton>
      </form>

      <ul className="mt-6 space-y-2">
        {[
          "The token is sent once over HTTPS and never returned to the browser.",
          "Writes happen only after you approve a changeset, and only on an openmi/agent/ branch.",
          "Disconnecting deletes the sealed value immediately.",
        ].map((line) => (
          <li key={line} className="flex items-start gap-2.5 text-[11.5px] leading-relaxed text-low">
            <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-accent" />
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrashList({ chats }: { chats: Chat[] }) {
  if (chats.length === 0) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="eyebrow">trash</p>
        <h2 className="mt-2 text-[20px] font-semibold tracking-[-0.02em] text-hi">
          Trash is empty
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          Deleted chats wait here until you purge them. Restoring one puts it
          back in the sidebar, in its folder.
        </p>
        <Link href="/chat" className="btn mt-6">
          Back to chats
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <p className="text-[13px] leading-relaxed text-mid">
        Deleted chats keep their messages and folder until you purge them.
        Purging is permanent.
      </p>

      <ul className="panel mt-5 divide-y divide-line overflow-hidden">
        {chats.map((chat) => (
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
              <form action={restoreChat}>
                <input type="hidden" name="chatId" value={chat.id} />
                <SubmitButton className="btn px-3 py-1 text-[11px]" pendingText="Restoring…">
                  Restore
                </SubmitButton>
              </form>

              <form action={purgeChat}>
                <input type="hidden" name="chatId" value={chat.id} />
                <ConfirmSubmit
                  message="Permanently delete this chat and its messages?"
                  className="rounded-full border border-danger/30 bg-danger/8 px-3 py-1 text-[11px] text-danger hover:opacity-90"
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
          className="btn px-4 py-1.5 text-[12px]"
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
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">pick a repository</p>
            <h2 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-hi">
              One chat, one repository.
            </h2>
            <p className="mt-2 font-mono text-[10.5px] text-low">
              @{github.connection.login} ·{" "}
              {github.connection.scopes.length > 0
                ? github.connection.scopes.join(", ")
                : "fine-grained token"}{" "}
              · ends {github.connection.lastFour}
            </p>
          </div>

          <form action={disconnectGithub}>
            <ConfirmSubmit
              message="Disconnect GitHub? The sealed token is deleted and the workspace stops reading repositories."
              className="btn px-3 py-1.5 text-[11.5px]"
            >
              Disconnect
            </ConfirmSubmit>
          </form>
        </div>

        <p className="mt-4 max-w-xl text-[13px] leading-relaxed text-mid">
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
          <div className="mt-6">
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
  const models = modelCatalogue();

  const [messages, changesets, runningTurn] = await Promise.all([
    listMessages(session.supabase, chat.id),
    loadChangesets(session.supabase, chat.id),
    // A turn keeps running after the tab closes. Reading the flag here is what
    // turns "the answer will arrive" into something the page can show.
    session.supabase
      .from("agent_turns")
      .select("turn_id")
      .eq("chat_id", chat.id)
      .eq("status", "running")
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .maybeSingle(),
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
        <p className="mb-3 flex flex-wrap items-center gap-2 rounded-full border border-line bg-card px-4 py-2 text-[11.5px] text-mid">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-line-strong" />
          No repository attached, so answers have nothing to cite.
          <Link
            href={`/chat?chat=${chat.id}&view=repos`}
            className="font-medium text-accent-text hover:underline"
          >
            Pick one
          </Link>
        </p>
      )}

      {changesets.length > 0 && (
        <div className="mb-3 max-h-[46vh] shrink-0 overflow-y-auto">
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
          models={models}
          initialModel={hasModel(models, chat.model) ? chat.model : DEFAULT_MODEL}
          initialMessages={messages}
          validPaths={validPaths}
          pinnedPath={null}
          providerReady={providersConfigured()}
          initialRunning={Boolean(runningTurn.data)}
        />
      </div>
    </div>
  );
}

function DraftChat() {
  const models = modelCatalogue();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatPanel
        chatId={null}
        repo={null}
        models={models}
        initialModel={DEFAULT_MODEL}
        initialMessages={[]}
        validPaths={[]}
        pinnedPath={null}
        providerReady={providersConfigured()}
        initialRunning={false}
      />
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
        <p className="eyebrow">not configured</p>
        <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-hi">
          The workspace needs Supabase
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          Chats, folders and the trash live in Postgres behind row-level
          security. Without a project configured there is nowhere to put them.
        </p>
        <Link href="/setup" className="btn btn-primary mt-6 w-fit px-4 py-2">
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
        "id, title, folder_id, repo_full_name, repo_branch, repo_base_sha, model, created_at, updated_at, deleted_at, last_message_at"
      )
      .order("updated_at", { ascending: false }),
    readConnection(supabase, user.id),
    supabase.from("profiles").select("dew_balance").eq("id", user.id).maybeSingle(),
  ]);

  const dewBalance = Number(
    (profileResult.data as { dew_balance?: number | string } | null)?.dew_balance ?? 0
  );

  const folders = (foldersResult.data ?? []) as Folder[];
  const allChats = (chatsResult.data ?? []) as Array<
    Chat & { last_message_at: string | null }
  >;

  const liveChats = allChats.filter((chat) => !chat.deleted_at);

  // A conversation exists once it has a message. Chats created by the old
  // "instant row on click" behaviour stay in the database but leave the list.
  const historyChats = liveChats.filter((chat) => chat.last_message_at !== null);
  const trashedChats = allChats.filter((chat) => chat.deleted_at);
  const activeChat = params.chat
    ? liveChats.find((chat) => chat.id === params.chat) ?? null
    : null;

  const draft = params.new === "1";

  const heading = trashView
    ? "Deleted chats"
    : draft
      ? "New chat"
      : params.repo
        ? params.repo
        : activeChat
          ? activeChat.title
          : connection
            ? "Pick a repository"
            : "Connect GitHub";

  const eyebrow = trashView
    ? "Trash"
    : draft
      ? "Chats"
      : params.repo
        ? "Workspace"
        : "Chats";

  // The workspace is a second view of the same chat, not a second page: a
  // citation opens the file beside the conversation, and the URL says which.
  const workspaceView = params.view === "files" || params.view === "repos";

  let body: React.ReactNode;
  if (trashView) {
    body = <TrashList chats={trashedChats} />;
  } else if (!connection) {
    body = <ConnectPanel />;
  } else if (draft) {
    body = <DraftChat />;
  } else if (activeChat && !workspaceView) {
    body = await ChatView({ session, chat: activeChat });
  } else {
    body = await RepoSurface({ session, params, chat: activeChat });
  }

  const lowBalance = isLowBalance(dewBalance);

  const banner =
    params.error || (params.connected && !params.error) ? (
      <p
        role={params.error ? "alert" : "status"}
        className={`border-b px-4 py-2 text-[11.5px] md:px-7 ${
          params.error
            ? "border-danger/25 bg-danger/8 text-danger"
            : "border-line bg-raised text-mid"
        }`}
      >
        {params.error ? (
          params.error
        ) : (
          <>
            GitHub connected as{" "}
            <span className="font-mono text-hi">{params.connected}</span>.
          </>
        )}
      </p>
    ) : undefined;

  return (
    <AppShell
      sidebar={
        <Sidebar
          email={user.email ?? "signed in"}
          folders={folders}
          chats={historyChats}
          activeChatId={activeChat?.id}
          trashView={trashView}
          trashedCount={trashedChats.length}
        />
      }
      eyebrow={eyebrow}
      title={heading}
      banner={banner}
      actions={
        <>
          {activeChat?.repo_full_name && activeChat.repo_base_sha && (
            <Link
              href={`/chat?chat=${activeChat.id}&repo=${encodeURIComponent(activeChat.repo_full_name)}&branch=${encodeURIComponent(activeChat.repo_branch ?? "")}&sha=${activeChat.repo_base_sha}&view=files`}
              className="btn hidden px-3 py-1.5 text-[11.5px] sm:inline-flex"
            >
              Files
            </Link>
          )}

          <Link
            href="/activity"
            title={`An hour of chat costs ${DEW_PER_HOUR} Dew. Low balance shows amber below ${LOW_BALANCE_DEW}.`}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] ${
              lowBalance
                ? "border-warn/35 bg-warn/8 text-warn"
                : "border-line bg-card text-low"
            }`}
          >
            <span aria-hidden="true" className="size-1 rounded-full bg-current" />
            dew {formatDew(dewBalance)}
          </Link>

        </>
      }
    >
      {body}

    </AppShell>
  );
}
