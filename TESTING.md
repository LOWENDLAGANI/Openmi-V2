# Testing Openmi end to end

**Audience:** a person or an AI tester picking this repository up cold.
**Purpose:** one file that says what to run, what needs an account, and how to get
into the app without typing a login form. It describes behaviour that was
observed against a production build in this checkout, not a wish list.

The product itself is pre-release. That is why a test sign-in exists at all; it
is removed from the configuration before the site is public. See
[Safety](#safety-never-ship-the-test-sign-in).

---

## 1. Fast path — everything that needs no account

From the repository root:

```bash
bun install --frozen-lockfile
bun run typecheck          # tsc --noEmit
bun run test               # 469 tests across 58 files
bun run check:migrations   # every migration applies twice, schema complete
bun run test:rls           # anon and a second account read nothing of the first
bun run check:contrast     # every text pair clears 4.5:1 in all three themes
NEXT_PUBLIC_SITE_URL=https://ci.invalid bun run build
```

All seven exit `0` on this checkout. The build deliberately runs with no
secrets: nothing in this app may need one to compile.

Browser smoke tests (need the build above, then a Chromium download):

```bash
bunx playwright install chromium
bun run test:e2e           # boots `next start` on :3100 itself
```

`e2e/smoke.spec.ts` has two specs: the sign-in page renders with no
configuration, and the setup report names missing configuration instead of
failing. If the browser download is blocked on your machine, run steps 2–4 below
with `curl` — they cover the same doors.

---

## 2. No-login surfaces, as observed

Requested from a production build (`bun run build && PORT=3210 bun run start`):

| Path | Status | What it proves |
|---|---|---|
| `/` | 200 | Landing page renders with no session |
| `/about` | 200 | The contract page renders; no account needed |
| `/login` | 200 | The heading `Sign in to Openmi` is present |
| `/setup` | 200 with no Supabase; redirect to `/login` when signed out; 404 when forbidden | Operator-only once accounts exist; the one exception is a deployment with no accounts at all |
| `/chat` | **307** → `/login?next=%2Fchat` | The middleware gate is a redirect, not a blank page |
| `/test-login` | **404** while the flag is off | The test door does not exist unless explicitly configured |
| `/does-not-exist` | 404 | The not-found surface renders |

An AI can verify all of the above with `curl -s -o /dev/null -w '%{http_code}'`,
and the sign-in page's content with a `grep` for the heading.

---

## 3. The test sign-in (no form)

`GET /test-login?next=/chat` signs in a fixed account and redirects into the
app. It writes an **ordinary Supabase session** — RLS still decides every row.
It removes the typing, not the account, and it grants nothing the account did
not already have.

### Set it up once

1. In Supabase → Authentication → Users, create a user for testing and confirm
   its email (a password sign-in fails while the address is unconfirmed).
2. Give that account whatever it needs for the flow you are testing: connect a
   GitHub token from the workspace, and make sure its Dew balance is not zero.
3. In `.env.local` (never committed), set:

```bash
OPENMI_TEST_LOGIN=on
OPENMI_TEST_LOGIN_EMAIL=you+openmi-test@example.com
OPENMI_TEST_LOGIN_PASSWORD=the-account-password
```

4. Restart `bun run dev` and open `http://localhost:3000/test-login?next=/chat`.

### Rules the route enforces

- Flag off, or either credential missing, or a malformed email, or a password
  under 8 characters → **404**, with the body `Not found`.
- Credentials come from the server environment only. The URL picks the
  destination (`next`, same-origin only); it can never carry a password.
- Accounts not configured at all → `503`, because there is no auth service to
  call.
- Wrong password or unconfirmed email → `502`, with a message that does not say
  which of the two it was.

The policy lives in [`lib/test-login.ts`](lib/test-login.ts) and is covered by
[`tests/test-login.test.ts`](tests/test-login.test.ts); the route is
[`app/test-login/route.ts`](app/test-login/route.ts).

---

## 4. What to exercise after signing in

Each row is a real surface; the right column is how you know it worked rather
than merely loaded.

| Surface | Expected |
|---|---|
| `/chat` (new chat) | Composer renders, model menu opens, price chip says `pay on send` |
| Pick a repository | Repo list from the connected token, private badge, search filters the list |
| Open a file | Tree → file viewer with line numbers, pinned commit shown |
| Send a message | Streaming answer; Stop works; Dew chip updates; no answer is invented after an error |
| Ask for an edit | Review card with per-file diffs; accept/reject per file; nothing is written to GitHub before approval |
| Approve | One `openmi/agent/…` branch and one pull request; the default branch is refused |
| `/activity` | Ledger rows sum to the balance; invite code and redeem form render |
| `/pay` | Plans and the hosted payment button; no card form exists |
| `/admin` | Reachable only for an operator email; receipts, grants, setup report |
| `/setup` | Env names present/missing, migration drift, live probes — values never printed |

Things that need a third party, and therefore cannot be proven without one: a
GitHub token (repo reads and the PR write), an AI provider key (any answer), an
E2B key (sandbox verification), a Resend key (receipt email). State the check as
blocked, not as passed, when the key is absent.

Two behaviours worth knowing before you call them bugs:

- **Ads.** With an Adsterra key set, a browser with an ad blocker is shown a
  blocking wall instead of the app; `/setup` and `/admin` stay reachable, and
  with no key set the wall never appears. The unit above the composer appears
  only inside a stored chat — never on sign-in, never in a draft chat.
- **Temporary chats do not exist yet.** If one is added, it must never be saved,
  and by construction it has no stored chat id, so it gets no composer ad.

---

## 5. Paste-ready prompt for another AI

> You are testing a pre-release Next.js 15 app called Openmi in this repository.
> Read `TESTING.md` first and follow it literally.
>
> 1. Run every command in §1 and report the exact exit status of each, plus the
>    test and migration counts. Do not report a suite as passing unless its exit
>    code was 0.
> 2. Verify the no-login surface table in §2 against a production build, using
>    `curl` for status codes and content checks.
> 3. Set up the test sign-in from §3 (ask me for the test account credentials via
>    the environment; never ask me to paste them into chat), restart the dev
>    server, and confirm `GET /test-login?next=/chat` lands signed in.
> 4. With the session active, walk §4 in order and report, per row, what you
>    observed: URL, HTTP status, and the text or element you used as evidence.
> 5. Report anything that loads but does not work as a failure with the console
>    error or response body that shows why.
> 6. Finish with: checks run and their exit codes; checks blocked and which key
>    or account is missing; and a list of UI states you did not look at.
>
> Do not modify product behaviour to make a check pass, do not disable the ad
> gate or the auth gate, and do not weaken a test.

---

## 6. Safety: never ship the test sign-in

`OPENMI_TEST_LOGIN` turns a URL into a session for a known account. On a public
deployment that is an open door for anyone who learns the path.

- Keep the three variables out of Production and Preview environments. Set them
  only locally, or on a throwaway test deployment behind an access control.
- Before launch: unset the flag, delete the test account, and confirm
  `/test-login` answers 404 on the deployed origin.
- The password belongs in the environment, never in this file, a commit, a
  screenshot or a chat message.

The route is inert by default and 404s without the flag — verified in this
checkout — so "forgot to remove the code" is not the same risk as "forgot to
remove the variables". Removing the variables is the whole rollback.

---

## 7. What this file does not prove

The browser specs in `e2e/` were authored and are part of `bun run test:e2e`, but
the Chromium download was interrupted in this workspace, so they are documented
rather than observed here. Everything in §1 and §2 was run. Nothing in §4 was
executed against a live Supabase project, a GitHub token or a provider key in
this checkout.
