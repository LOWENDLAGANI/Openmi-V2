import Link from "next/link";
import { redirect } from "next/navigation";

import { connectGithub, disconnectGithub } from "@/app/github/actions";
import { AppShell } from "@/components/AppShell";
import { ChatPanel } from "@/components/ChatPanel";
import { PreviewPanel } from "@/components/PreviewPanel";
import { VersionPanel } from "@/components/VersionPanel";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { DewChip } from "@/components/DewChip";
import { SubmitButton } from "@/components/SubmitButton";
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
import { oauthConfigured } from "@/lib/oauth/github";
import { firstAvailableModel, hasModel } from "@/lib/models";
import { modelCatalogue, providersConfigured } from "@/lib/providers";
import { checkpointsEnabled } from "@/lib/execution/checkpoints/plan";
import { previewEnabled } from "@/lib/execution/preview/plan";
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

function ConnectPanel({ oauthEnabled }: { oauthEnabled: boolean }) {
  return (
    <div className="mx-auto w-full max-w-xl py-8">
      <p className="eyebrow">step one</p>
      <h2 className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-hi">
        Connect GitHub
      </h2>
      <p className="mt-3 text-[13px] leading-relaxed text-mid">
        Token scopes: contents, pull requests, metadata.
      </p>

      {oauthEnabled && (
        <div className="mt-5">
          <a
            href="/auth/github"
            className="btn btn-primary w-full py-2.5 text-[13px]"
          >
            Continue with GitHub
            <span aria-hidden="true" className="text-[13px] leading-none">
              →
            </span>
          </a>
          <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-low">
            or paste a personal access token below
          </p>
        </div>
      )}

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
        <Link href="/chat" className="btn mt-6">
          Back to chats
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
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

  if (!github) return <ConnectPanel oauthEnabled={oauthConfigured()} />;

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

  const [messages, proposals, runningTurn, profileResult, autoApproval] =
    await Promise.all([
    listMessages(session.supabase, chat.id),
    loadChangesets(session.supabase, chat.id),
    // A turn keeps running after the tab closes. Reading the flag here is what
    // turns "the answer will arrive" into something the page can show.
    session.supabase
      .from("agent_turns")
      .select("turn_id")
      .eq("chat_id", chat.id)
      .eq("status", "running")
      .eq("cancel_requested", false)
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .maybeSingle(),
    session.supabase
      .from("profiles")
      .select("dew_balance, wallet_dew")
      .eq("id", session.user.id)
      .maybeSingle(),
    session.supabase
      .from("branch_autoapprovals")
      .select("branch")
      .eq("owner", session.user.id)
      .eq("repo_full_name", chat.repo_full_name ?? "")
      .eq("branch", chat.repo_branch ?? "main")
      .maybeSingle(),
  ]);

  const balances = (profileResult.data ?? {}) as {
    dew_balance?: number | string;
    wallet_dew?: number | string;
  };
  const dew = {
    balance: Number(balances.dew_balance ?? 0),
    wallet: Number(balances.wallet_dew ?? 0),
  };
  const autoApproveBranch =
    (autoApproval.data as { branch?: string } | null)?.branch ?? null;

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
          No repository attached.
          <Link
            href={`/chat?chat=${chat.id}&view=repos`}
            className="font-medium text-accent-text hover:underline"
          >
            Pick one
          </Link>
        </p>
      )}

      {proposals.error ? (
        <div
          role="alert"
          className="mb-3 shrink-0 rounded-2xl border border-danger/25 bg-danger/8 px-4 py-2.5 text-[11.5px] leading-relaxed text-danger"
        >
          <p className="font-medium">Your proposals could not be loaded.</p>
          <p className="mt-1 text-[11px]">
            The change is stored; this page could not read it. Reloading is
            safe. If this deployment was just updated, a database migration may
            still be pending — an operator can check the setup report.
          </p>
          <p className="mt-1 font-mono text-[10.5px] opacity-80">
            {proposals.error}
          </p>
        </div>
      ) : proposals.changesets.length > 0 ? (
        <div className="mb-3 max-h-[46vh] shrink-0 overflow-y-auto">
          <ReviewPanel
            changesets={proposals.changesets}
            chatId={chat.id}
            chatSha={chat.repo_base_sha}
            chatBranch={chat.repo_branch ?? null}
            autoApproveBranch={autoApproveBranch}
          />
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        {/* The preview sits above the transcript rather than beside it: the
            chat column is the page's one column at every width, and a second
            pane would have to compete with it on a phone. */}
        {repo ? (
          <>
            <VersionPanel chatId={chat.id} enabled={checkpointsEnabled()} />
            <PreviewPanel chatId={chat.id} enabled={previewEnabled()} />
          </>
        ) : null}

        <div className="min-h-0 flex-1">
          <ChatPanel
            chatId={chat.id}
          repo={repo}
          models={models}
          initialModel={
            hasModel(models, chat.model) ? chat.model : firstAvailableModel(models)
          }
          initialMessages={messages}
          validPaths={validPaths}
          pinnedPath={null}
          providerReady={providersConfigured()}
            initialRunning={Boolean(runningTurn.data)}
            dew={dew}
          />
        </div>
      </div>
    </div>
  );
}

async function DraftChat({
  repo,
}: {
  repo: { fullName: string; branch: string; sha: string } | null;
}) {
  const models = modelCatalogue();

  // The composer offers a price before the chat exists, so it needs both
  // balances. Reading them here keeps the call site a repository and nothing
  // else, which is what the draft-chat test pins.
  let dew = { balance: 0, wallet: 0 };
  const session = await getSession();

  if (session.state === "signed-in") {
    const { data } = await session.supabase
      .from("profiles")
      .select("dew_balance, wallet_dew")
      .eq("id", session.user.id)
      .maybeSingle();

    const row = (data ?? {}) as {
      dew_balance?: number | string;
      wallet_dew?: number | string;
    };

    dew = {
      balance: Number(row.dew_balance ?? 0),
      wallet: Number(row.wallet_dew ?? 0),
    };
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatPanel
        chatId={null}
        repo={repo}
        models={models}
        initialModel={firstAvailableModel(models)}
        initialMessages={[]}
        validPaths={[]}
        pinnedPath={null}
        providerReady={providersConfigured()}
        initialRunning={false}
        dew={dew}
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
        <p className="eyebrow">unavailable</p>
        <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-hi">
          Openmi is unavailable right now
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          We can&apos;t load your workspace at the moment. Try again in a few
          minutes.
        </p>
      </main>
    );
  }

  const { supabase, user } = session;
  const trashView = params.trash === "1";

  // The daily allowance is settled before anything is rendered, so the chip
  // shows the balance the next turn will actually use.
  await refillDailyDew(supabase);

  const [foldersResult, chatsResult, connection, profileResult, hourResult] = await Promise.all([
    supabase.from("folders").select("id, name, created_at").order("name"),
    supabase
      .from("chats")
      .select(
        "id, title, folder_id, repo_full_name, repo_branch, repo_base_sha, model, created_at, updated_at, deleted_at, last_message_at"
      )
      .order("updated_at", { ascending: false }),
    readConnection(supabase, user.id),
    supabase
      .from("profiles")
      .select("dew_balance, wallet_dew")
      .eq("id", user.id)
      .maybeSingle(),
    // The running hour, read with the same predicate `start_hour_session` uses
    // to reuse one: a session is live while `expires_at` is still ahead.
    supabase
      .from("hour_sessions")
      .select("expires_at")
      .eq("owner", user.id)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle(),
  ]);

  const dewBalance = Number(
    (profileResult.data as { dew_balance?: number | string } | null)?.dew_balance ?? 0
  );
  const dewWallet = Number(
    (profileResult.data as { wallet_dew?: number | string } | null)?.wallet_dew ?? 0
  );

  const hourEndsAt =
    (hourResult.data as { expires_at?: string } | null)?.expires_at ?? null;
  // The countdown measures against this, not against the device clock: a phone
  // hours behind used to read an eight-hour session out of a one-hour row.
  const hourServerNow = new Date().toISOString();

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

  // The repository the reader is currently looking at: either the one in the
  // URL, or the one pinned to the open chat. A new chat inherits it, which is
  // what makes "pick a repo, then start chatting" work.
  const draftRepo =
    params.repo && isRepoFullName(params.repo)
      ? {
          fullName: params.repo,
          branch: params.branch ?? "",
          sha: params.sha && isCommitSha(params.sha) ? params.sha : "",
        }
      : null;

  const currentRepo =
    draftRepo ??
    (activeChat?.repo_full_name && activeChat.repo_base_sha
      ? {
          fullName: activeChat.repo_full_name,
          branch: activeChat.repo_branch ?? "",
          sha: activeChat.repo_base_sha,
        }
      : null);

  // A bare /chat starts a new chat and reuses the repository from the most
  // recent conversation, so the first message has something to cite. The
  // picker is a place you navigate to (?view=repos), not where /chat lands.
  const latestRepo =
    draftRepo ??
    (() => {
      const recent = liveChats.find(
        (chat) => chat.repo_full_name && chat.repo_base_sha
      );

      if (!recent?.repo_full_name || !recent.repo_base_sha) return null;

      return {
        fullName: recent.repo_full_name,
        branch: recent.repo_branch ?? "",
        sha: recent.repo_base_sha,
      };
    })();

  const heading = trashView
    ? "Deleted chats"
    : draft
      ? "New chat"
      : params.repo
        ? params.repo
        : activeChat
          ? activeChat.title
          : connection
            ? "New chat"
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
    body = <ConnectPanel oauthEnabled={oauthConfigured()} />;
  } else if (draft) {
    body = <DraftChat repo={draftRepo} />;
  } else if (activeChat && !workspaceView) {
    body = await ChatView({ session, chat: activeChat });
  } else if (workspaceView) {
    // The repository browser is a place you ask for: the sidebar's Repositories
    // row and every citation link pass `view`.
    body = await RepoSurface({ session, params, chat: activeChat });
  } else {
    body = <DraftChat repo={latestRepo} />;
  }

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
          repo={currentRepo}
          hourEndsAt={hourEndsAt}
          hourServerNow={hourServerNow}
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

          <DewChip initialBalance={dewBalance} initialWallet={dewWallet} />

        </>
      }
    >
      {body}

    </AppShell>
  );
}
