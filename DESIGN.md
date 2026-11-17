# Openmi design system

A plain-text design document (the format from
[awesome-design-md](https://github.com/VoltAgent/awesome-design-md) / Google
Stitch). An agent reads this before touching UI. It describes what already
exists in `app/globals.css`; the stylesheet is the authority, and this file
explains why it is shaped that way.

## 1. Visual theme and atmosphere

Two surfaces, one identity.

- **The product** is a working window: paper canvas, white cards, hairlines, no
  gradients, no ornament. It should read as a native app, not as a website.
- **The front door** (`app/page.tsx`, everything under `.lp`) is a shopfront:
  larger type, a real product frame, more air, one section per screen.

Density is generous everywhere and type does the work. Nothing is tilted,
staggered, layered, or glowing for its own sake. The brand line the whole
system serves is *shows its work*: a citation, an exit code, a diff.

## 2. Colour (semantic tokens only)

Never write a hex value in a component. Every colour is a token in
`app/globals.css`, swapped by a class on `<html>`: `:root` is paper (the
default), `html.dark` is carbon, `html.ink` is ink.

| Token | Role |
| --- | --- |
| `--bg`, `--bg-raised`, `--card`, `--chip`, `--hover`, `--elevated`, `--dock` | surfaces, in that order of elevation |
| `--line`, `--line-strong` | hairline borders; never a shadow where a line will do |
| `--text-hi`, `--text`, `--text-mid`, `--text-low` | type, in that order of emphasis |
| `--accent`, `--accent-text`, `--accent-soft`, `--on-accent` | anything the reader owns: their bubble, the send control, an active row, an addition in a diff |
| `--bubble-user`, `--bubble-user-text` | the reader's message |
| `--danger`, `--warn` + their `-bg`, `-border`, `-strong` pairs | failures and limits |
| `--azure`, `--code` | model badges and inline code |
| `--card-shadow` | the only shadow in the product |

Tailwind sees these as `bg-card`, `text-mid`, `border-line`, and so on through
the `@theme inline` block. Contrast is a gate, not a claim:
`node scripts/check-contrast.mjs` must pass for all three themes.

## 3. Typography

Two faces, with fixed jobs.

- **Display:** Fraunces (`--font-display`), loaded by `next/font` in the root
  layout. Headlines only, at weight 500–600, tracking `-0.02em` to `-0.04em`.
- **Product text:** the operating system's own face (`--font-sans`). The chat
  surface is measured around 16px/1.5 and should read as native.
- **Front door text:** Instrument Sans (`--font-ui`, applied by `.lp` only).
- **Mono:** `--font-mono` for commands, paths, line numbers, diff gutters, and
  the small caps-ish labels that used to be tracked-out uppercase.

Sizes are rem-relative and fluid: the landing `h1` is
`clamp(2.45rem, 5.2vw, 4.15rem)`, section `h2` is `clamp(1.75rem, 3.2vw, 2.5rem)`,
body 13–15.5px. Numbers always carry `tabular-nums`.

## 4. Components

- **Buttons** (`.btn`): one pill shape, 1px border, transparent fill. Variants:
  `.btn-primary` (accent fill, `--on-accent` print), `.btn-quiet`,
  `.btn` + `.lift` for hover-step and press. One primary per screen.
- **Fields** (`.field`): pill, `--line-strong`, accent ring on `:focus-visible`.
  16px minimum inside `@media (max-width: 640px)` so iOS does not zoom.
- **Cards** (`.panel`, `.msg-ai-card`): `--card` on `--line`, radius 16–20px.
  A hover on an inert card changes border and shadow, never position.
- **Status** (`.alert`, `.alert-danger`, `.alert-warn`): one shape, an icon, a
  title, and a body that breaks anywhere.
- **The front door frame** (`.preview-frame`, `.preview-bar`, `.diff-row`): the
  product drawn in HTML, never an image. Additions use `--accent`, deletions
  `--danger`, both at ~8% tint with an inset 2px rule.
- **Sections** (`.lp-section`): `min-height: 100svh`, content vertically
  centred, `scroll-margin-top: 4rem` for the fixed header.

## 5. Layout

- `.lp-wrap` is the only column: `min(100% - 2.5rem, 1200px)`, widening to a
  5rem gutter at 768px. Every block starts on the left line and ends on the
  right one. No centred block wider than half the column.
- Landing screens use a 12-column grid at `md`; splits are text left, visual
  right, top-aligned, never mirrored.
- The product uses `max-w-3xl`/`max-w-5xl` reading columns and a fixed 3.5–4rem
  header. The sidebar is a rail, not a card.
- Phones: one column, full-width buttons, `env(safe-area-inset-*)` at the
  edges, nothing that scrolls sideways at 320px.

## 6. Depth and elevation

Hairlines first. `--card-shadow` for a card that sits on the canvas; a single
large soft shadow for the landing frame. Blur (`backdrop-filter`) is reserved
for the two fixed bars: `.glass` (header) and `.composer-dock`. Never nest two
shadows.

## 7. Motion

Compositor-only: `transform` and `opacity`, 150–380ms, easing
`cubic-bezier(0.22, 0.8, 0.2, 1)`. `.rise-in` / `.animate-enter` is the one
entrance, used once per screen. `.lift` steps a control 1px up on hover and
0.985 down on press. Everything rests under
`@media (prefers-reduced-motion: reduce)`, and no content depends on motion to
become visible.

## 8. Do's and don'ts

- Do import every number from `lib/credits.ts`; never type a price.
- Do state what was observed. If a run did not happen, the page says so.
- Do keep one idea per screen and one primary action per screen.
- Don't add a colour, radius, shadow, or font that is not in this file.
- Don't use a gradient as a background for white cards, or as body text.
- Don't put a caption, tag, or "sample" note on a visual.
- Don't hide content behind an animation, a carousel, or a scroll effect.
- Don't use violet or lavender anywhere in Openmi's own design.
- Don't claim a test, a review, or a deployment the product did not observe.

## 9. Where things live

| Path | Holds |
| --- | --- |
| `app/globals.css` | tokens, component classes, motion, the landing layer |
| `app/page.tsx` | the five screens of the front door |
| `components/LandingPreview.tsx` | the workspace frame and the turn trace |
| `components/Brand.tsx`, `OpenmiMark.tsx` | the mark, in one piece |
| `components/ThemeSwitcher.tsx` | paper / carbon / ink, a class on `<html>` |
| `scripts/check-contrast.mjs` | the gate that keeps the palette honest |
