# Openmi design system

A concise visual specification for Openmi (`app/globals.css` is the source of
truth for tokens; this document defines the architectural rules and the
anti-slop constraints).

## 1. Visual direction

Precision Developer Platform (Vercel / Linear / Raycast):

- **Product workspace** (`/chat`, `/pay`, `/activity`): monochrome neutral
  surfaces, crisp 1px hairline borders, electric cobalt accent (`#0055dd` light,
  `#2563eb` dark/slate), zero decorative gradients or glowing backdrops.
- **Public front door** (`app/page.tsx`, `.lp`): asymmetric architectural
  12-column grid, generous whitespace without forced `100svh` voids, real
  interactive HTML workbench (`components/LandingPreview.tsx`), and structured
  footer.

## 2. Colour (semantic tokens only)

Never hardcode hex values inside components. Every colour comes from CSS custom
properties in `app/globals.css`, switched via a class on `<html>`:

- `:root` (`paper` in storage): Light (`#fafafa` canvas, `#ffffff` cards,
  `#09090b` ink, `#0055dd` cobalt accent, `#18181b` user bubble).
- `html.dark` (`dark` in storage): Obsidian Dark (`#09090b` canvas, `#111113`
  raised/card, `#fafafa` ink, `#2563eb` cobalt accent, `#27272a` user bubble,
  `--surface: none`).
- `html.ink` (`ink` in storage): Midnight Slate (`#0c1118` canvas, `#121a24`
  card, `#f1f5f9` ink, `#2563eb` cobalt accent, `#1e3a5f` user bubble,
  `--surface: none` — zero purple or lavender).

Contrast is enforced mechanically: `node scripts/check-contrast.mjs` must pass
at 4.5:1+ for every semantic pair across all three themes.

## 3. Typography

Two faces, loaded via `next/font/google` in `app/layout.tsx`:

- **Display & UI (`--font-geist-sans`)**: Geist across headings, body, and
  product controls (`tabular-nums` on figures and ledgers).
- **Code & Technical Meta (`--font-geist-mono`)**: Geist Mono for diffs,
  commit hashes, paths, tool calls, line numbers, and keyboard hints.

## 4. Radii & components

Crisp developer-platform geometry (`6px`–`12px` radii):

- **Buttons (`.btn`)**: `8px` (`0.5rem`) radius, 1px border (`--line-strong`),
  `.btn-primary` uses `--accent` with crisp top inner highlight.
- **Fields (`.field`)**: `8px` (`0.5rem`) radius, 16px minimum on mobile viewports.
- **Panels & Dialogs (`.panel`, `.composer-card`, `.preview-frame`)**: `12px`
  (`0.75rem`) radius with 1px hairline border and subtle `--card-shadow`.
- **Badges & Tags**: `6px` (`0.375rem`) radius (`rounded-md`). Avoid full pill
  (`999px`) chrome on status badges, forms, or buttons.

## 5. Anti-AI-slop rules

Pinned in `tests/design-tells.test.ts`:

- Never use Fraunces, Instrument Sans, Inter-on-purple, or cream/teal/lavender
  themes.
- Never use gradient-clipped headline text (`.gradient-text`, `bg-clip-text`) or
  radial glow backdrops behind dark-mode surfaces.
- Never draw fake macOS traffic-light dots (`.preview-dots`), pulsing status
  dots (`badge-pulse`), or rainbow animated input borders (`Beam`).
- Never use tracked-out uppercase eyebrows above every section heading, left-border
  accent callout stripes (`shadow-[inset_3px_0_0_var(--accent)]`), or
  negative-parallelism marketing clichés.
- Never claim unobserved test runs, builds, or deployments.
