# Patches

Verified changes against `LOWENDLAGANI/Openmi` `test` at `08a049d`.

| Patch | Covers | Checks before export |
| --- | --- | --- |
| `phase-0-1-verified.patch` | Phase 0 (documentation truth, `check-contrast.mjs`, ratchet baseline, CI step) and Phase 1 (the two contrast tokens, `--on-accent`, bubble token split) | `bun run typecheck`, `node scripts/check-contrast.mjs`, `tests/theme-literals.test.ts`, `tests/limits-docs.test.ts` — all exit 0 |

Apply from the repository root:

```
git am patches/phase-0-1-verified.patch     # keeps the message and author
git apply --check patches/phase-0-1-verified.patch   # dry run only
```

The commit is authored `Openmi <openmi@users.noreply.github.com>` per
`agent-push-requirements.md`. Two things the patch deliberately does not carry:

- `bun.lock`. `bun install --frozen-lockfile` fails at `08a049d` with
  "lockfile had changes, but lockfile is frozen", so CI's install step is red
  before any code changes. Regenerating the lockfile fixes it, but that is a
  dependency decision, not a doc fix — it belongs in its own commit.
- The 12-component literal migration and Phase 2 (F-05, F-07, F-08, F-10).
  `scripts/theme-literals-baseline.json` records the current 949 literals so
  those slices can lower it rather than raise it.
