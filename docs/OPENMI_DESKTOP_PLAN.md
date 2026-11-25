# Openmi Desktop — Locked Build Plan

Windows desktop coding agent. Rust core, TypeScript UI, local project folders, no cloud.

## Product

- Windows 10/11 x64 desktop app that opens a folder on the user's disk and works inside it.
- No account, no cloud workspace, no credits, no Supabase, no E2B, no hosted inference.
- One window, one active project, chat tabs per project; recent projects reopen.
- Works in any folder; git is optional (used for diffs/history/checkpoints when present).
- Visual design matches the Openmi workbench, ported from `DESIGN.md` and `app/globals.css`.
- Usable fully offline with Ollama or LM Studio.
- Bar for v1: daily-driver local coding agent — open a real project, work in it, recover from mistakes, install cleanly.

## Locked decisions

- **UI stack:** Tauri 2 + React 19 + TypeScript + Vite + Tailwind v4.
- **Rust scope:** Rust core only; UI stays TypeScript.
- **Platform:** Windows 10/11 x64 only; no macOS/Linux in v1.
- **Edit model:** direct edits plus checkpoint undo (no mandatory review gate).
- **Command isolation:** none beyond approvals and checkpoints; the app says it is not sandboxed.
- **Providers:** exact Openmi OpenAI-compatible family plus Ollama/LM Studio, one adapter.
- **Auto routing:** deferred to v1.1; v1 ships named models.
- **GitHub:** no API/OAuth/token storage; `git`/`gh` through the terminal when the user asks.
- **Remote writes:** always require explicit approval, even in Trusted mode.
- **Optional surfaces:** embedded terminal and agent browser are in v1.
- **Repository:** new repo, clean Rust rewrite; do not fork the Next.js app.
- **Privacy:** anonymous usage analytics, opt-in, minimal schema.
- **Distribution:** signed per-user MSI/NSIS plus optional portable zip.
- **Team/time:** one engineer, 3–6 months.

## Scope

### In v1

- Open/recent project folders, optional git detection, one project per window.
- Chat tabs, streaming answers, separate reasoning fold, Markdown and code rendering.
- Tools: read, write, exact-once edit, list, search, run command, background processes, local git read, todo, fetch URL, browser.
- Embedded terminal panel (ConPTY) with tabs; agent and user sessions kept separate.
- Diff panel, per-file and whole-run undo, checkpoint history.
- Provider settings with keys in Windows Credential Manager, connection test, local model endpoints.
- Trust/permission modes, command approvals, secret redaction, diagnostics.
- Signed installer, portable zip, signed auto-update, first-run onboarding.

### Not in v1

- Supabase, auth, accounts, credits, billing, rate limits, moderation, admin, presence, ads, feedback.
- Cloud sync, mobile, multi-user collaboration, missions/autonomous runs, deploy/publish.
- Plugin marketplace, LSP/debugger, macOS/Linux.
- Multi-window, ACP/other agents, WSL2 command backend (post-v1).

### Required warning copy

- "This app is not sandboxed. It can read and change files and run commands with your Windows account's permissions. Approvals and checkpoints reduce accidents; they are not a security boundary."

## Permission model

- **Read-only:** reads, search and git inspection only.
- **Ask (default):** writes, commands, browser and network fetches need approval; reads are automatic.
- **Trusted:** routine writes and commands run without prompts; everything is logged and checkpointed; remote-affecting commands still ask.
- Per-project command allowlist (`cargo test`, `npm run build`, `pnpm lint`) instead of only a global switch.

## Stack and layout

- Shell: Tauri 2 with WebView2.
- Storage: SQLite (WAL) at `%LOCALAPPDATA%\Openmi\openmi.db`.
- Secrets: Windows Credential Manager via `keyring`.
- Terminal: ConPTY via `portable-pty`.
- Browser: installed Microsoft Edge over CDP; bundled Playwright Chromium only as fallback.
- Packaging: Tauri bundler, per-user NSIS/MSI, Authenticode signing, signed updater, portable zip.
- Crates: `openmi-core`, `openmi-store`, `openmi-platform`, `openmi-cli`, `openmi-desktop`.
- `openmi-core` must be UI-agnostic and runnable from the CLI; every milestone testable without a window.
- Directories: `crates/`, `ui/`, `fixtures/`, `docs/decisions/`.

## Architecture

- UI → Tauri commands → `openmi-desktop` → `openmi-core`; run events flow back as deltas, tool events, settled.
- `openmi-platform` owns paths, processes/job objects, keychain, ConPTY.
- `openmi-store` owns SQLite chats, runs, events, changes.
- One active run per chat, one run globally in v1.
- A run is a Tokio task with a cancellation token.
- Every event persisted before it is emitted; reload and crash recovery rebuild from `run_events`.
- No local HTTP server in v1; Tauri IPC is the boundary.
- User terminals and agent commands use separate process registries, both visible in a Processes view.

## Key crates

- Async: `tokio`.
- HTTP/SSE: `reqwest` plus `eventsource-stream` or a small parser.
- Serialization: `serde`, `serde_json`.
- Git: `git2` (evaluate `gix` later).
- Walking/ignore: `ignore`, `walkdir`, `globset`.
- Search: `grep-searcher`, `grep-regex` (no `rg.exe` dependency).
- Diff: `similar`.
- SQLite: `rusqlite` (bundled) + `refinery`, or `sqlx`.
- Keychain: `keyring`.
- Watch: `notify`.
- Processes: `tokio::process`, `portable-pty`, `windows`.
- Browser: `chromiumoxide`.
- Paths: `dunce`, `windows`.
- Logs: `tracing`, `tracing-appender`.
- Tests: `tempfile`, `wiremock`/`axum`, `assert_cmd`.
- Packaging: Tauri bundler, `tauri-plugin-updater`.
- Do not add a web framework, ORM, cloud SDK, auth library, autocapture telemetry SDK or second UI framework.

## Agent runtime

### Caps

- 70 model steps per turn.
- 2,000,000 estimated tokens per turn (`ceil(chars / 4)`).
- 30 minutes wall clock per turn.
- 200 KB / 2,000 lines per file read.
- 40 search hits.
- 32 KB command output tail.
- 400 context paths.
- 4,000,000 character context budget.
- 1 concurrent run.
- 4 background processes per run.
- Pinned/open file is never trimmed; if it busts the budget, keep it and say why nothing else was added.

### Loop contract

- Persist user message, create `runs` row (`queued` → `running`).
- Assemble context: project instructions (`AGENTS.md`, `CLAUDE.md`, `README.md`, capped), tree, open file, attachments.
- Stream one provider request with tool schemas; parse content, reasoning and incremental tool-call arguments.
- Execute tool calls sequentially, persist each result, append tool messages, loop.
- Stop on: no tool calls, cancel, step cap, token cap, wall clock, fatal error.
- Persist stop reason and an honest note; settle the run; emit `run.settled`.
- Cancellation checked at every step and tool boundary; in-flight commands get a token that kills the process tree; partial text and reason persisted.
- On startup a `running` row whose process is gone becomes `interrupted` with its last event seq; offer "continue" as a new turn, never pretend the stream resumed.

### Providers

- `openrouter` (UnoRouter): `https://api.unorouter.com/v1/chat/completions`.
- `straitly`: `https://api.straitly.ai/v1/chat/completions`.
- `deepseek`: `https://api.deepseek.com/chat/completions`.
- `experiential`: `https://api.experientiallabs.ai/v1/chat/completions`.
- Model ids copied from `lib/models/routes.ts`, names/blurbs from `lib/models.ts`; never invented.
- Keys per provider, user-supplied, stored in Credential Manager, never sent to the renderer.
- Local endpoints: Ollama `http://127.0.0.1:11434/v1`, LM Studio `http://127.0.0.1:1234/v1`.
- Warn when a local model has no tool-call support; allow a configurable context window.

### Adapter rules

- Do not retry on another key once a delta reached the UI; show the partial answer and the failure.
- Send `reasoning_effort`/`thinking` only to providers that define it.
- Echo `reasoning_content` back on assistant tool-call messages for thinking providers.
- Treat an empty completion with reasoning as reasoning, not an answer.
- Normalize tool-call fragments by index; parse JSON once at finish.
- Auto routing (`lib/routing/*`, 50-route pool, overlap trimming) is post-v1.

### Context

- Ignore-aware tree, sorted, capped; cached and invalidated on file events or turn boundary.
- Open file or explicit selection/pin is strongest context.
- Read project instructions once per turn; repository text is data, never authority over app policy.
- Do not embed the repo; tools retrieve, context is a map.

## Tool surface

- One JSON object per call; unknown keys refused; central path guard before any filesystem or shell use; results capped and redacted.
- `read_file`: line-numbered read, offset/limit, binary refusal, 200 KB / 2,000 lines.
- `write_file`: whole-file atomic write, create parents, 200 KB, preserve BOM/line endings, refuse no-op.
- `edit_file`: exact unique replacement, refuse 0 or >1 matches.
- `list_files`: ignore-aware list, optional prefix, 300 paths.
- `search_files`: literal search via ripgrep libs, 40 hits, `path:line`.
- `run_command`: one command, wait, exit code and output tail; purpose required; cwd inside project; 120 s; 32 KB.
- `start_process`: detached process with log/pid, max 4, Job Object.
- `read_process`: tail a process log, 200 lines.
- `kill_process`: kill the process tree via Job Object and verify the port is freed.
- `git_status`, `git_diff`, `git_log`, `git_show`: local git only, capped.
- `todo`: plan shown to the user, no filesystem effect.
- `fetch_url`: public page as text, public https only, SSRF guard, 200 KB, 12 s.
- `browser`: Edge over CDP — goto, click, fill, type, press, scroll, wait, back, screenshot, text, console; 24 actions, 3 MB screenshot, 15 s waits.
- No `github_read`, `github_action`, `publish` or `apply_changes` tools; GitHub work is ordinary `git`/`gh` in the terminal.

### Shell policy

- Prefer PowerShell 7 (`pwsh`), else Windows PowerShell, with `-NoLogo -NoProfile -NonInteractive`.
- Offer cmd and Git Bash in Settings.
- Force UTF-8 output where possible; strip ANSI.
- Tool description and system prompt must name the active shell; never assume bash syntax.

### Terminal policy

- User terminal sessions are not the agent's; the agent runs in its own process group.
- Both are visible in the Processes view.
- The agent must never inject into a user's interactive terminal.

### Browser policy

- Allow `http(s)` only; block `file:`, `javascript:`, `data:`.
- Allow `localhost`/`127.0.0.1` only for the current project's dev server or an explicit user action; block private, link-local and metadata addresses otherwise.
- Persist cookies/state per project in app data; offer "clear browser data".
- Screenshots are attachments and stay out of the repo and `git status`.
- Ship screenshot + text + console first; add full action sequences later.

## Edits, diffs, undo

- Before a run's first write and before any destructive command: checkpoint.
- Git repo: tree object from worktree state, update `refs/openmi/checkpoints/<run-id>`; never touch `HEAD`, index or user branches.
- Non-git folder: copy affected files into a content-addressed store under `%LOCALAPPDATA%\Openmi\projects\<id>\objects`.
- Edits apply immediately; diff panel shows them; undo restores a file or the whole run atomically.
- Retention 30 days by default, configurable; deleting a project removes its checkpoints.
- Detect and preserve line endings and BOM (UTF-8, UTF-16LE/BE); never normalize untouched lines; refuse unsafe encodings.
- Binary files show "binary changed", not a fake diff.
- Cap rendered diffs (60,000 chars / 2,000 lines), keep full text in the checkpoint store, say when clipped.
- Show renames and mode changes as such.
- Review mode (detached worktree or shadow copy with Apply/Discard) is optional per project and post-v1.

## Persistence

- SQLite at `%LOCALAPPDATA%\Openmi\openmi.db`, WAL, foreign keys, busy timeout, transactional migrations.
- Tables: `projects`, `chats`, `messages`, `runs`, `run_events`, `tool_calls`, `checkpoints`, `file_changes`, `attachments`, `settings`.
- `messages.seq` assigned under a per-chat transaction, never by timestamp.
- `run_events` append-only; previews only, not archives.
- Provider keys never in SQLite; store a label/ref only.
- Verify the project's canonical path still points at the same folder on startup; never silently follow a moved or replaced path.
- Offer JSON export of chats and a "delete project data" action that removes rows, checkpoints and attachments.

## Windows checklist

### Paths

- Manifest `longPathAware`; use `\\?\` verbatim paths where needed.
- Canonicalize with `GetFinalPathNameByHandleW`; compare to the workspace root case-insensitively.
- Reject `..`, absolute, drive-relative (`C:foo`), UNC (unless the workspace is UNC), ADS (`:`), reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1–9`, `LPT1–9`), trailing dots/spaces and control chars.
- Refuse reparse points that escape the root; re-check the canonical path after opening where possible.
- Treat `Foo.ts` and `foo.ts` as the same file; never show both in a diff.

### Files

- Atomic replace: sibling temp file, flush, `ReplaceFileW` or `MoveFileExW(REPLACE|WRITE_THROUGH)`.
- Retry `ERROR_SHARING_VIOLATION` / `ACCESS_DENIED` with backoff.
- Preserve BOM/line endings; new files follow `.gitattributes`/`.editorconfig`, else LF for code.
- Surface read-only attribute and ACL failures clearly, never skip silently.
- Detect OneDrive placeholders; ask before hydrating a large tree.
- Do not follow directory symlinks while walking unless configured; guard cycles.

### Processes and terminal

- Job Object per run/process with `KILL_ON_JOB_CLOSE`; assign children; kill the job then verify the port is free.
- PowerShell with `-NoProfile -NonInteractive`; decode UTF-16LE correctly; strip ANSI.
- Never run elevated; refuse `runas` and UAC-bypass commands.
- Close stdin for non-interactive commands; timeouts must kill, not hang.
- Track detached processes across turns; on exit offer to stop them or warn.
- ConPTY terminal: tabs, cwd, resize, scrollback, copy/paste; agent never injects into it.

### Packaging

- Per-user install, no admin; NSIS/MSI; portable zip.
- Bootstrap WebView2 when missing.
- Authenticode-sign the exe and installer; unsigned local-agent binaries trigger SmartScreen and antivirus.
- Signed auto-update manifest with a pinned public key.
- Rotating logs; "copy diagnostics" with redacted logs; no automatic upload.
- Test Windows 10 and 11, 100/125/150/200% DPI, IME, high contrast, reduced motion.

## Security and trust

- Assets: files, git history, environment credentials, provider keys, browser sessions.
- Threats: prompt injection from repo/web content, destructive commands, path/junction escape, secret exfiltration, compromised update, tampered local DB.
- Controls: first-open trust gate, approval broker showing exact command/cwd/diff, checkpoints before writes, central path jail with adversarial tests.
- Remote-affecting commands (`git push`, `gh pr create`, package publish, non-localhost network) always ask, even in Trusted mode.
- `fetch_url` SSRF guard; browser restricted to http(s) with localhost only for the project dev server.
- Best-effort secret redaction in outputs (secret-looking env values, common token patterns); say it is best-effort.
- No automatic uploads; GitHub writes only through user-requested terminal commands.
- Signed installers and updates.
- Diagnostics page states what is stored and how to delete it.
- Use Git Credential Manager for git/gh; never capture or store GitHub tokens; redact credential-bearing URLs.

## Analytics

- Opt-in, default off; first-run consent screen, persistent Settings toggle, "what we collect" page.
- Collect only: random install id, app version, OS version/arch, event name, status, duration bucket, step-count bucket, tool name, error code.
- Never collect prompts, messages, file names, paths, repo names, URLs, model keys, screenshots or code.
- Events: `app_opened`, `project_opened`, `run_started`, `run_settled`, `tool_used`, `error`, `update_installed`.
- No autocapture, no session replay, no person profiles; batch over HTTPS; drop silently when offline.
- Behind an `AnalyticsSink` interface with a no-op implementation.
- README and About page state exactly what is sent.
- Turning analytics on by default is a deliberate trade against the local-first story; never done silently in code.

## Feature map: port, adapt, drop

- Port: file tree/viewer/search, streaming chat with reasoning fold and `path:line` citations, `lib/runs` tool semantics, design tokens.
- Add: embedded terminal, agent browser, local git tools.
- Replace: `propose_edits`/changesets/approval→branch→PR becomes direct edits + checkpoints; `/setup` and `/about` become Settings → Providers/Diagnostics.
- Drop: GitHub repo picker and pinned commit, GitHub read/write modules, Supabase auth/RLS/middleware, credits/billing/invites, rate limits/moderation/admin/presence/ads, E2B sandbox, serverless runs/SSE reconnection/HMAC envelopes, preview/publish/deployments, PWA/mobile.

## Delivery plan

### Honest schedule

- Core + desktop chat + edits/undo + terminal + packaging: 4–5 months.
- Above + browser + hardening + analytics + signed updater: 5–7 months.
- Hitting 3 months means core + chat + edits/undo + commands only; defer terminal, browser and updater.
- Cut order if the schedule slips: browser first, then terminal, then auto-update.
- Do not cut path safety, encoding correctness, checkpoints or packaging.

### Milestones

- **M0 — Decisions and spikes (1–2 weeks).** Tauri window, typed command and event, path guard, fake SSE completion, git2 hidden-ref checkpoint, Edge CDP screenshot. Exit: demo plus five ADRs.
- **M1 — Headless core (3–4 weeks).** Types, provider adapter, SSE, tool registry, path guard, context, caps, cancellation, SQLite, CLI. Exit: scripted 5-step turn in a temp repo passes with a stop reason.
- **M2 — Desktop shell and chat (3–4 weeks).** Project open/recent, chat tabs, streaming timeline, reasoning fold, Markdown/code, file tree/viewer, design tokens. Exit: open a folder, chat with a real provider, cancel, reopen to the same transcript.
- **M3 — Edits, diffs, undo (3–4 weeks).** Atomic writes, BOM/CRLF, exact-once edits, diff panel, per-file and whole-run revert, git and non-git checkpoints. Exit: edit a real project, revert both scopes, verify bytes.
- **M4 — Commands and terminal (3–4 weeks).** PowerShell, timeout, output cap, redaction, Job Objects, background process registry, ConPTY tabs, approval policy UI. Exit: start a dev server, read its log, kill the tree, confirm the port is free; cancel a build with no orphan.
- **M5 — Browser (3–4 weeks).** Edge CDP basics then full actions, localhost dev-server rule, cookie persistence. Exit: drive a local form, screenshot it, block `file://` and metadata addresses.
- **M6 — Hardening (2–3 weeks).** Path/encoding adversarial suite, secret redaction, SSRF, analytics consent, crash recovery, diagnostics, reduced-motion/high-contrast/IME. Exit: threat model and tests for every control.
- **M7 — Packaging and release (2–3 weeks).** NSIS/MSI, WebView2 bootstrap, portable zip, Authenticode, signed updater, onboarding. Exit: clean Windows 10/11 VM install, update and uninstall without admin.
- **M8 — Post-v1 (optional).** Auto routing, review mode, multi-window, GitHub PR helpers, WSL2 command backend, macOS.

### Build order

- Path guard plus tests.
- Headless core plus fake provider and integration test.
- SQLite, event log and crash recovery.
- Tauri shell and streaming chat.
- Writes, diffs, checkpoints and undo.
- Commands and terminal.
- Browser.
- Packaging and signing.
- Analytics behind a flag, then polish.
- A polished UI over an unsafe filesystem layer is the failure mode; never start with the design system.

## Testing

- Unit (fast, no network): path guard (traversal, absolute, drive-relative, UNC, ADS, reserved, trailing dot/space, case duplicates, junction escape), encoding (UTF-8 BOM, UTF-16LE/BE, CRLF/LF/CR, mixed, binary), exact-once edits, context budget, caps/stop reasons, diff clipping.
- Integration: fake OpenAI-compatible server emitting text, reasoning, fragmented tool calls, mid-stream error, empty completion; temp repo full turn asserting files, events and DB rows; kill mid-turn then reopen and assert `interrupted` plus partial text.
- Windows CI on `windows-latest`: build, unit, integration, headless core smoke; manual/VM checklist for installer, WebView2, long paths, OneDrive placeholders, antivirus, IME.
- No real model calls in CI; optional nightly real-provider smoke that never blocks merges.
- Per-milestone gates: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `npm run typecheck`, `npm run build`.
- A milestone is done only when its acceptance scenario is scripted or documented and failures produce useful messages.

## Risks

- Path/encoding bugs corrupting user files → central guard, atomic writes, BOM/CRLF preservation, adversarial tests, checkpoint before write.
- Browser scope swallowing the schedule → ship screenshot/text first, full actions later, cut browser before safety.
- Terminal + browser vs a 3-month target → plan 5–6 months or defer browser; never cut checkpoints.
- Users assuming isolation → persistent "not sandboxed" copy, approvals, optional WSL2 later.
- Unreliable model tool-calling → strict schemas, typed errors, one tool per step, visible repair/failure.
- Context cost on large repos → tree caps, ignore rules, tool retrieval, visible estimate.
- Antivirus/SmartScreen → sign binaries, portable zip, false-positive submission.
- Scope creep into cloud/billing → locked non-goals enforced in README and prompt.
- Analytics eroding trust → opt-in, minimal schema, auditable interface, no autocapture.
- Git library limits → `git2` for v1, documented `git` CLI fallback, test worktrees and hidden refs.

## Handoff brief for the coding agent

- Start with `openmi-platform::paths` and its tests; do not scaffold the UI first.
- Port behaviour, not files: read `lib/runs/tools.ts`, `lib/runs/loop.ts`, `lib/context.ts`, `lib/provider-stream.ts`, `lib/changesets.ts`; reimplement in Rust; copy no Supabase, Next.js route, E2B or auth code.
- One milestone per branch/PR, each ending with its acceptance scenario and the §Testing gates passing.
- No new cloud dependencies: no Supabase, hosted DB, auth service or autocapture telemetry SDK; ask before adding any service.
- Pin dependencies deliberately with `cargo add`, commit `Cargo.lock`, run `cargo deny`/`cargo audit` where available; never hand-write invented versions.
- Write the failing test first for path, encoding, exact-once edit, checkpoint restore and stop reasons.
- Preserve the design tokens from `DESIGN.md` and `app/globals.css`; no purple, gradients, fake macOS dots or marketing hero; workbench first.
- Never claim verification that was not run; app copy and agent prompt follow `docs/OPENMI_SYSTEM_PROMPT.md`.
- Keep the scope freeze: anything not in "In v1" is post-v1.
- Demo each milestone on Windows; green `cargo test` on Linux does not prove Windows paths, processes, signing or WebView2.
- Read in order: `DESIGN.md`, `lib/runs/limits.ts`, `lib/runs/tools.ts`, `lib/runs/loop.ts`, `lib/context.ts`, `lib/providers.ts`, `lib/provider-stream.ts`, `lib/changesets.ts`, `docs/OPENMI_SYSTEM_PROMPT.md`, migrations `002_chats.sql`, `004_chat.sql`, `006_changesets.sql`.
- Ignore as implementation models: `app/api/**`, `lib/supabase/**`, `lib/execution/**`, `lib/credits/**`, `lib/billing/**`, `lib/github/write.ts`, `lib/agent/envelope.ts`, and migrations beyond the three above.

## Reference map

- Loop, cancellation, stop reasons → `lib/runs/loop.ts` (step/tool sequencing, caps, honest settlement).
- Tool semantics → `lib/runs/tools.ts` (read/write/edit/search/command, path checks, redaction).
- Caps → `lib/runs/limits.ts` (70 steps, 2M tokens, 30 min, 200 KB, 32 KB).
- Context → `lib/context.ts` (pinned file wins, 400 paths, trim notes).
- Providers → `lib/providers.ts`, `lib/provider-stream.ts` (SSE, reasoning, tool fragments, no retry after first token).
- Shell/process design → `lib/agent/shell.ts` (purpose text, line-numbered reads, detached processes, group kill).
- Changeset caps/UX → `lib/changesets.ts`, `components/AppliedChanges.tsx`.
- Persistence shape → migrations 002/004/005/006 (`seq` ordering, run rows, event log).
- Design system → `DESIGN.md`, `app/globals.css`.
- Truth rules → `docs/OPENMI_SYSTEM_PROMPT.md`.

## Non-goals

- Multi-user, cloud sync, mobile, marketplace, multi-agent orchestration.
- Autonomous missions, billing, hosted inference, automatic deploy.
- Full IDE/debugger/LSP, remote workspaces, macOS/Linux in v1.
