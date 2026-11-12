# Bolt.new's stack — what it is, and what Openmi can actually replicate

**Question:** can Openmi replicate Bolt.new's full stack?

**Verdict:** the **UX** yes, the **runtime** no — not without a commercial
WebContainer licence and giving up every non-JavaScript repository. Openmi's
existing E2B sandbox is the stronger runtime for a repo-native agent; what is
worth copying from Bolt is the editor, the error-to-fix loop and the instant
preview feel.

Companion documents: [OPENMI_APP_BUILDER_PLAN.md](OPENMI_APP_BUILDER_PLAN.md)
(why this matters) and [APP_BUILDER_BUILD_PLAN.md](APP_BUILDER_BUILD_PLAN.md)
(the executable tasks).

---

## 1. The stack, layer by layer

| Layer | Bolt.new (hosted) | stackblitz/bolt.new (MIT repo) | bolt.diy (MIT fork) |
|---|---|---|---|
| Frontend | Remix + React | Remix + React, Vite | React Router v7 + React 19, Vite |
| Styling / state | UnoCSS | UnoCSS, nanostores | UnoCSS, nanostores |
| Editor | in-product code view | **CodeMirror 6** | CodeMirror 6 |
| Terminal | in-product terminal | `@xterm/xterm` | `@xterm/xterm` |
| Runtime | **WebContainers** (WASM Node in the tab) | WebContainers (`@webcontainer/api`) | WebContainers |
| AI layer | hosted, metered | Vercel AI SDK, one provider (Anthropic) | Vercel AI SDK, ~15 providers + Ollama |
| File persistence | project storage + IndexedDB snapshots | **IndexedDB only** | IndexedDB (`boltHistory`: chats, snapshots) |
| Preview | hosted preview URLs; in-browser on Chromium | ServiceWorker-mapped ports, `server-ready` event | same |
| Deploy | `bolt.host`, Netlify | not in the repo | Netlify, Vercel, GitHub Pages |
| GitHub | two-way sync, GitHub App | not in the repo | clone/push through a server proxy |

The repo is a **demo of the loop**, not the product: token metering, hosting,
multiplayer and the WebContainer runtime itself are not in it.

## 2. How Bolt's preview actually works

There is no server. WebContainers boots a Node environment with WebAssembly, and
the browser's **ServiceWorker** maps the virtual TCP stack onto real URLs:

```js
webcontainer.on("server-ready", (port, url) => { iframe.src = url });
webcontainer.on("port", (port, "open" | "close", url) => { /* ... */ });
```

That is why the preview feels instant and costs nothing to host — and why the tab
is the machine. Reload the tab and the ephemeral in-memory filesystem is gone
unless the app re-mounts a snapshot from IndexedDB. No multi-user, no
cross-device, no background work after the tab closes.

To make this work the page must be **cross-origin isolated**: `COOP:
same-origin` and `COEP: require-corp` (or `credentialless`), HTTPS, and the app
may **not register its own ServiceWorker** because WebContainers uses one as part
of its networking stack.

## 3. The hard limits (these decide the question)

| Limit | Consequence |
|---|---|
| JavaScript / WebAssembly only | no real Python (a RustPython subset, no `pip`), no Go, Rust, PHP, Java |
| `--no-addons` | no native modules: `sharp`, `bcrypt`, `better-sqlite3`, `node-gyp` builds fail |
| No native services | no Postgres, MySQL, Redis, Docker inside the box |
| Memory is the tab's | OOM is a `WebAssembly.instantiate` failure, not a clean quota error |
| Cross-origin isolation required | **app-wide COOP/COEP breaks embedded third-party content** — Supabase auth redirects, fonts, images, analytics |
| Safari | beta; some previews must be hosted rather than in-browser |
| Firefox | alpha; no credentialless mode, third-party preview assets break |
| No background execution | closing the tab ends the "server" |

Openmi's users point it at *their* repositories. A large share of those are not
pure JavaScript, and the ones that are still use native dependencies. A runtime
that cannot `bun install` a repo with `sharp` is not a downgrade in polish, it is
a different product.

## 4. Licensing — the part that is easy to miss

| Thing | Licence |
|---|---|
| stackblitz/bolt.new app code | MIT |
| bolt.diy app code | MIT |
| **WebContainer API runtime** | **commercial licence required for production / for-profit use**, even internal; prototypes exempt; sales-led pricing, enforced via `configureAPIKey()` |
| `webcontainer-core` GitHub repo | MIT, but it is an issue tracker — the runtime is closed |

So "fork bolt.diy and ship it" is MIT-legal right up to the moment it faces
paying users, at which point the runtime is a negotiated cost. That cost has no
public number, which makes it impossible to price into Dew honestly before a
sales conversation.

## 5. Fit against Openmi

| Layer | Bolt | Openmi today | Action |
|---|---|---|---|
| Runtime | WebContainers, browser | E2B microVM, server-side | **keep E2B** — native deps, any language, Playwright, background processes |
| Preview | ServiceWorker ports | none (P13) | build it on `getHost(port)` |
| Editor | CodeMirror 6 | file viewer only | add a CodeMirror tab (no Monaco) |
| Error loop | preview errors forwarded into chat | Playwright console errors in a tool result | forward preview runtime errors into the turn |
| Persistence | IndexedDB | Supabase + sandbox disk | already better |
| AI | server proxy + token meter | provider chain + Dew ledger | already better |
| Deploy | bolt.host / Netlify | none (P16) | Vercel deploy |
| Version history | snapshots | changeset revert only (P14) | checkpoints |
| COOP/COEP | required app-wide | not set | **do not** adopt app-wide; isolate any WebContainer surface on its own origin |

## 6. Replication options

### A. Port the runtime (WebContainers)

Fork bolt.diy's UI, boot WebContainers, keep E2B for heavy work.

- Cost: commercial licence, a second runtime with different semantics, COOP/COEP
  on a dedicated origin, and a hard "JavaScript only" story for the in-browser
  path.
- Verdict: **no for now.** Two runtimes means every preview bug becomes "which
  box was that", and the licence cannot be priced.

### B. Hybrid preview (WebContainer for UI, E2B for builds)

- Cost: the licence plus duplicated preview plumbing, plus explaining to a user
  why one tab is fast and the other takes 40 seconds.
- Verdict: **no.** Complexity without a capability win.

### C. Keep E2B, borrow Bolt's loop (recommended)

Copy the parts that are UX, not runtime:

1. **Editor tab.** CodeMirror 6 (`@codemirror/*`) reading and writing workspace
   files through the existing shell tools — `read_file` / `write_file` already
   exist in `lib/agent/sandbox.ts`. A manual save is a workspace change; it still
   reaches GitHub only through a changeset.
2. **Error-to-fix loop.** Forward the preview's runtime errors (the browser tool
   already returns console errors) into the next turn as a real observation, and
   offer "fix this" with the error text attached.
3. **Instant preview.** Same-origin proxy to `getHost(port)`, polling reload
   first (the plan's T1.3), HMR later if a dedicated proxy is worth it.
4. **Version history.** Checkpoints (P14) presented the way Bolt presents version
   history, not as a git log.
5. **Open in StackBlitz.** A one-click escape hatch that opens the repository in
   StackBlitz's own editor uses *their* hosted environment, so it needs no
   runtime licence from you. Verify their embed terms before shipping it.

What not to copy: ServiceWorker networking, IndexedDB as the source of truth,
app-wide COOP/COEP, and the "no server" claim — Openmi's promise is the opposite,
that a real machine ran the command.

## 7. What changes in the build plan

Three additions to P13, no reordering:

- **T1.7 Editor tab** — CodeMirror 6 in a third tab, save semantics explicit
  ("saved to the sandbox, not to GitHub").
- **T1.8 Preview error forwarding** — the preview panel captures
  `window.onerror` / unhandled rejections through the proxy and offers them to
  the composer as an observation.
- **Header audit** — before the iframe ships, confirm the preview origin's
  `frame-ancestors` / `frame-src` and that no app-wide COOP/COEP header exists.

The runtime decision (D1 in the build plan) is unchanged: E2B, with the
exposure question still open.

## 8. Sources

- Bolt's own explanation of WebContainers: https://support.bolt.new/reference/faq
- Supported technologies (JS-only backends, Safari differences): https://support.bolt.new/concepts/supported-technologies
- Hosting and `bolt.host` limits: https://support.bolt.new/cloud/hosting
- OSS repo and its scope: https://github.com/stackblitz/bolt.new
- bolt.diy (React Router v7, providers, deploy targets): https://github.com/stackblitz-labs/bolt.diy
- WebContainer quickstart, cross-origin isolation, service worker rule: https://webcontainers.io/guides
- WebContainer API reference (`mount`, `spawn`, `server-ready`, `forwardPreviewErrors`): https://webcontainers.io/api
- WebContainer troubleshooting (JS/WASM only, `--no-addons`, OOM): https://webcontainers.io/guides/troubleshooting
- Browser support (Safari beta, Firefox alpha): https://webcontainers.io/guides/browser-support
- Commercial licensing: https://webcontainers.io/enterprise , https://stackblitz.com/terms-of-service
- bolt.new MIT licence: https://github.com/stackblitz/bolt.new/blob/main/LICENSE
- bolt.diy MIT licence + WebContainer caveat: https://github.com/stackblitz-labs/bolt.diy/blob/main/LICENSE
