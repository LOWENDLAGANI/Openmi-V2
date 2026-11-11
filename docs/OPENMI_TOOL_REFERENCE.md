# Openmi — Tool Reference

**What this file is.** The system tool reference for Openmi, adapted from a Claude
Sonnet 5 tool dump (`docs/reference/claude-sonnet-5-tools.raw.txt`). Every entry
below is a tool Openmi actually sends to a model, described from its schema and
from the constant that enforces its cap.

**What it is not.** Not a proposal. A tool listed here exists in
[`lib/agent/tools.ts`](../lib/agent/tools.ts),
[`lib/execution/mission/tools.ts`](../lib/execution/mission/tools.ts) or
[`lib/agent/browser.ts`](../lib/agent/browser.ts). A tool that only appears in a
vendor dump is listed in §6 as deliberately absent.

**Ground rules that apply to every tool**

- Arguments are one JSON object. Unknown keys are refused (`bad-input:
  unexpected argument`), so a tool call never half-applies.
- Every error is prefixed by kind: `bad-input:` (the request is wrong),
  `too-large:` (a cap was hit), `unavailable:` (a dependency is missing).
- No repository read tool takes a URL. Requests are built from the sealed GitHub
  token plus a repository-relative path, so the read surface cannot be pointed
  at an internal address. The one URL-taking tool is `browser`, and it only
  exists in a turn that has a sandbox.
- Paths are repository-relative. Absolute paths, `..`, backslashes, `://` and
  `.git` are refused before any network or filesystem call.
- A tool result is a fact. It is reported with its own text; it is never
  paraphrased into a stronger claim.

---

## 1. Chat turn surface

Available when the turn is pinned to a repository. Read tools are GitHub API
GETs; the write tool only proposes.

### `list_files`

List repository paths at the pinned commit.

| Argument | Type | Required | Notes |
|---|---|---|---|
| `prefix` | string | no | Directory prefix, e.g. `lib/`. Empty lists everything. |

- **Returns** `N path(s) match; showing M of at most 200` followed by one path
  per line.
- **Cap** `MAX_LIST_FILES = 200` (`lib/agent/tools.ts`).
- **Use when** the tree shape is unknown, or a prefix narrows the search faster
  than a text query.
- **Do not use** to enumerate the whole repository repeatedly; the context
  already carries up to `MAX_TREE_PATHS = 400` paths.

### `read_file`

Read one text file at the pinned commit, with line numbers.

| Argument | Type | Required | Notes |
|---|---|---|---|
| `path` | string | yes | Repository-relative, e.g. `lib/context.ts`. |

- **Returns** `path at <sha7> (<bytes> bytes)` then `1: …` numbered lines.
- **Caps** `MAX_READ_FILE_BYTES = 200_000`. Binary files are refused.
- **Refuses** traversal, absolute paths, URLs.
- **Use when** the answer needs exact lines. A citation must come from a read in
  this turn.
- **Note** line numbers are the pinned commit's, which is what a citation must
  match.

### `search_code`

Search the repository for literal text.

| Argument | Type | Required | Notes |
|---|---|---|---|
| `query` | string | yes | Literal text, at least 2 characters. |

- **Returns** `N match(es); M shown (cap 10)` then `path:line` per candidate.
- **Cap** `MAX_SEARCH_CANDIDATES = 10`.
- **Note** search runs against the default branch, while reads resolve at the
  pinned commit. A hit's line may have drifted; a citation must be confirmed by
  `read_file`.
- **Use when** the symbol name is known and the file is not.

### `propose_edits`

Propose a reviewable change. **Nothing is written to GitHub by this call.**

```json
{ "edits": [ { "path": "lib/context.ts", "mode": "replace",
               "find": "exact base text", "replace": "new text" } ] }
```

| Argument | Type | Required | Notes |
|---|---|---|---|
| `edits` | array | yes | 1–6 entries per call. |
| `edits[].path` | string | yes | Repository-relative. |
| `edits[].mode` | `"write" \| "replace"` | yes | `write` replaces the file, `replace` swaps one exact string. |
| `edits[].content` | string | for `write` | Whole new file. |
| `edits[].find` | string | for `replace` | Exact base text; must appear **exactly once**. |
| `edits[].replace` | string | for `replace` | Text that takes its place. |

- **Caps** `MAX_EDITS_PER_CALL = 6`, `MAX_EDIT_BYTES = 120_000` per file,
  `MAX_CHANGESET_FILES = 24` per changeset, `CHANGESET_TTL_MS = 6h`
  (`lib/changesets.ts`).
- **Fails that file, not the call**, when a `find` anchor is absent or appears
  more than once. A wrong-line edit is never silently applied. The three anchor
  cases are: `the file does not exist at the base commit, so there is no anchor
  to replace`, `the anchor was not found at the base commit`, and `the anchor
  appears N times; include more surrounding context so the replacement is
  unambiguous`.
- **One entry per file per call** (`a file may be proposed once per call`), no
  mixing `write` with `find`/`replace`, and a `write` identical to the base
  commit is refused as a no-op.
- **Unavailable** without a pinned repository and `GITHUB_TOKEN_KEY`
  (`unavailable: proposing edits needs a pinned repository and GITHUB_TOKEN_KEY`).
- **After the call** the user sees a unified diff per file and accepts or
  rejects each one. Approval writes one `openmi/agent/<changeset-id>` branch and
  one pull request. The model cannot write to GitHub, merge, or force a branch.

---

## 2. Mission surface

Available in mission mode, inside an ephemeral Linux sandbox with a checked-out
workspace at `MISSION_WORKDIR = "openmi-workspace"`. No platform credentials are
present, and there is no remote.

### `run_command`

Run one shell command and wait for it.

| Argument | Type | Required | Notes |
|---|---|---|---|
| `purpose` | string | yes | One readable line, ≤`MAX_PURPOSE_CHARS = 200`. |
| `command` | string | yes | Exact command, ≤`MAX_COMMAND_CHARS = 4_000`. |
| `cwd` | string | no | Directory inside the workspace. |
| `timeout_ms` | integer | no | Ceiling, clamped to `MISSION_FOREGROUND_MS = 120_000`. |

- **Returns** the exit code plus the output tail (≤32,768 bytes kept).
- **Use for** installs, builds, tests, inspection — anything that exits.
- **Do not use** for a dev server or watcher; those go to `start_process`.
- **Never** claim a pass without an exit code of 0 in the record.

### `read_file` (mission)

| Argument | Type | Required | Notes |
|---|---|---|---|
| `path` | string | yes | Workspace-relative. |
| `offset` | integer | no | First line, 1-based. |
| `limit` | integer | no | Lines returned, at most 400. |

- **Caps** `MAX_MISSION_READ_BYTES = 200_000`; `.git` and traversal refused.

### `write_file`

| Argument | Type | Required | Notes |
|---|---|---|---|
| `path` | string | yes | Workspace-relative. |
| `content` | string | yes | Whole file. |

- Creates parent directories. **Cap** `MAX_MISSION_WRITE_BYTES = 200_000`.
- The change is collected as a diff at the end of the mission; it is not a
  commit and not a push.

### `list_files` (mission)

| Argument | Type | Required | Notes |
|---|---|---|---|
| `path` | string | no | Subdirectory. |

- Skips `node_modules` and `.git`. **Cap** `MAX_MISSION_LIST = 300`.

### `search_files`

| Argument | Type | Required | Notes |
|---|---|---|---|
| `query` | string | yes | Literal text, ≥2 characters. |
| `path` | string | no | Subdirectory. |

- **Cap** `MAX_MISSION_SEARCH = 40` matches.

### `start_process`

| Argument | Type | Required | Notes |
|---|---|---|---|
| `purpose` | string | yes | One readable line. |
| `command` | string | yes | Exact command. |
| `cwd` | string | no | Directory inside the workspace. |

- **Returns** an id such as `p3`. The process is bounded by
  `MISSION_BACKGROUND_MS = 300_000` and dies with the mission.
- **Use for** a dev server, a watcher, or a long build inspected while it runs.
- **Not offered in plan mode**, alongside `write_file`.

### `read_process`

| Argument | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | The id `start_process` returned. |
| `lines` | integer | no | At most 200. |

### `kill_process`

| Argument | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | The id `start_process` returned. |

- Stop a process when it is no longer needed; a mission does not leave services
  running.

### `finish`

| Argument | Type | Required | Notes |
|---|---|---|---|
| `summary` | string | yes | What was done and what was observed. |
| `checks` | array | no | At most `MAX_FINISH_CHECKS = 12`. |
| `checks[].command` | string | yes | A command that ran in this mission. |
| `checks[].expect_exit_zero` | boolean | no | True only when claiming it passed. |

- Ends the mission. **`finish` is a request, not a truth**: `validateFinish`
  matches each claimed command against a recorded row by normalized text.
  `check N names a command that was not run in this mission` and `check N claims
  <command> passed, but it exited <code>` are both refusals the model can act
  on. The ledger still holds only what happened.
- **Limits** `summary` is required and ≤2,000 characters; at most 12 checks.
- Call it when the goal is met, or when a blocker is real. A short honest stop
  beats a fifth guess.

### Mission caps

| Cap | Value | Constant |
|---|---|---|
| Commands per mission | 200 | `MISSION_MAX_COMMANDS` |
| Model decisions | 60 | `MISSION_MAX_STEPS` |
| Tokens | 240,000 | `MISSION_MAX_TOKENS` |
| Output kept per command | 32,768 bytes | `MISSION_MAX_OUTPUT_BYTES` |
| Foreground command ceiling | 120s | `MISSION_FOREGROUND_MS` |
| Background process ceiling | 300s | `MISSION_BACKGROUND_MS` |
| Default length | 20 min | `MISSION_DEFAULT_MINUTES` |
| Hard maximum | 30 min | `MISSION_HARD_MAX_MINUTES` |
| Price | 0.05 Dew / started minute | `MISSION_DEW_PER_MINUTE` |
| Stall detection | 2 empty ticks | `MISSION_STALL_AFTER_EMPTY_TICKS` |
| Shown as paused after | 60s without a tick | `MISSION_IDLE_PAUSE_MS` |

---

## 3. Browser

### `browser`

Drive a page in headless Chromium through Playwright. One call is one page visit
with a short script of steps.

The spec is `BROWSER_TOOL_SPEC`, offered only in a turn that has a sandbox.

| Argument | Type | Required | Notes |
|---|---|---|---|
| `url` | string | no | `http` / `https` only. `file://` and `javascript:` are refused. Optional when the session is already on the page. |
| `actions` | array | no | Ordered steps, at most 24. Each needs a `type` plus its own fields. |
| `actions[].type` | string | yes | `goto`, `click`, `fill`, `type`, `press`, `scroll`, `wait`, `back`. |
| `actions[].url` | string | for `goto` | http(s) only. |
| `actions[].selector` | string | for `click` / `fill` | CSS selector. |
| `actions[].text` | string | for `click` / `type` | Visible text to click, or text to type. |
| `actions[].value` | string | for `fill` | Value for an input. **Never repeat it back in the answer.** |
| `actions[].key` | string | for `press` | e.g. `Enter`, `Tab`. |
| `actions[].y` | integer | for `scroll` | Pixels, at most 4,000. |
| `actions[].ms` / `selector` | integer / string | for `wait` | Either a duration (≤15,000ms) or a selector. |
| `full_page` | boolean | no | Capture the whole document rather than one viewport. Off by default. |
| `width` / `height` | integer | no | Viewport, default 1280×800, clamped 320–2,560. |
| `wait_ms` | integer | no | Settle time after the last step, at most 15,000. |
| `purpose` | string | no | One line the reader sees, e.g. `sign in and open settings`. |

- **Caps** `BROWSER_MAX_ACTIONS = 24`, viewport 320–2,560px (default 1280×800),
  `BROWSER_MAX_VALUE_CHARS = 1_000` per filled value,
  `BROWSER_MAX_SCROLL = 4_000`px per step, `BROWSER_MAX_IMAGE_BYTES = 3,000,000`
  per screenshot.
- **Returns** a screenshot plus the page's own status snapshot: final URL, title,
  HTTP status, per-step results, an excerpt of page text (≤4,000 chars) and
  console errors.
- **Availability** only when the turn has the sandbox surface. The analysis
  clause forbids using it to inspect a rendered page during a source review.
- **Safety** the URL and steps are written to a file and read by the script,
  never spliced into a command line, so a filled password does not appear in
  argv or in an error message. Cookies live in `/tmp/openmi-browser` inside the
  chat's box, outside the repository, and die with the container.

---

## 4. Editing rules that are enforced, not advised

| Rule | Where it is enforced |
|---|---|
| A `replace` anchor must appear exactly once | `validateEdits`, `lib/changesets.ts` |
| A path cannot be absolute, traverse, or point at `.git` | `safeRepoPath`, `lib/agent/tools.ts` |
| Unknown tool arguments are refused | `onlyKeys`, `lib/agent/tools.ts` |
| A command needs a `purpose` | `validateCommandArguments`, mission tools |
| A command's `cwd` outside the workspace is refused | `sanitiseWorkspacePath` |
| Plan mode offers no `write_file` and no `start_process` | `toolsForAutonomy` |
| A check claimed passing must have exited 0 | `validateFinish`, mission tools |
| A signed changeset expires after 6h | `CHANGESET_TTL_MS` |
| A stale continuation cannot replay steps | `agent_turns` compare-and-set |

---

## 5. Result reporting

- Show the tool name and its target before the result, e.g. `read lib/db.ts`.
- Quote the error kind and message; do not translate an error into a guess.
- A `too-large:` result means the input must shrink — `offset`/`limit` for a
  mission read, a narrower path for a repository read. It never means "retry
  unchanged".
- A screenshot belongs to the answer it supports. It is not stored, so a reload
  keeps the transcript but not the picture — say so if it matters.

---

## 6. Tools that do not exist here

Taken from the vendor dump and intentionally not implemented. Each one would be
a product change, not a schema tweak.

| Vendor tool | Openmi equivalent | Status |
|---|---|---|
| `bash_tool` | `run_command` (mission only) | present, narrower |
| `create_file`, `str_replace` | `propose_edits`, `write_file` | present as propose / mission write |
| `read_file`, `list_files`, `search` | same names | present |
| `TodoWrite` | none | absent — plans are prose and step rows |
| `Task` (subagents) | none | absent — one turn, one context |
| `Glob`, `Grep` | `list_files`, `search_code` | merged into two tools |
| `WebFetch`, `WebSearch` | no chat tool takes a URL | absent on the chat surface |
| `NotebookEdit` | none | absent — no notebooks |
| `ExitPlanMode` | mission autonomy `plan` / `act` / `ship` | replaced |
| `SlashCommand`, skills | none | absent — no command surface |
| `ask_user_input_v0` | none | absent — the assistant asks in prose when a question is truly needed |
| `fetch_sports_data`, `places_search`, `places_map_display_v0`, `message_compose_v1`, `image_search` | none | absent — out of product scope |
| `end_conversation` | none | absent — the user ends a chat |
| `KillShell`, `BashOutput` | `kill_process`, `read_process` | present for background processes |

---

## 7. Maintaining this file

- A new tool means a new `TOOL_SPECS` / `MISSION_TOOL_SPECS` entry, a named
  constant for every cap, a test that reads the constant, and an entry here.
- A tool that is removed leaves §6, not a stale row in the table above.
- Every number in this file is quoted from a constant. A number without a
  constant is a documentation bug.
