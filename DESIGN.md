# Openmi design system

A concise visual specification for Openmi (`app/globals.css` is the source of
truth for tokens; built with `design-taste-frontend` / `tasteskill 2.5.1`).

## 1. Dealt system (software / devtool)

- **Palette (`cool-grey-cobalt`)**: cool off-white ground (`#eef0f3`), raised
  surface (`#e2e5ea`), near-white card (`#f8f9fb`), ink (`#0b0c0e`), muted
  (`#505763`), cobalt accent (`#1f2de6`). Obsidian dark (`html.dark`: `#0b0c0e`)
  and Midnight slate (`html.ink`: `#0c1118`) keep the same semantic tokens with
  zero purple or lavender.
- **Typography (`instrument`)**: `Instrument Sans` (weights 400 and 500, tight
  tracking `-0.028em` / `-0.036em`, never bold-and-big) and `DM Mono` (400/500)
  for diffs, commit SHAs, file paths, tool calls, and tabular figures.
- **Radius (`sharp`)**: `4px` (`--r-sm`), `6px` (`--r-md`, `--r-btn`), `8px`
  (`--r-lg`). No `24px` marketing cards or `rounded-full` pill buttons.
- **Hero (`centred`)**: centred headline and actions over the live HTML
  workspace workbench resting on the dealt `sage` lit ground (`#cdd6c6`).
- **Nav (`nav-mega`)**: fixed opaque `64px` header with 1px hairline border,
  zero `backdrop-blur`, logo left, plain one-word links, `Sign in` and primary
  action right.
- **Rhythm (`dark-band`)**: one `.ground-inverse` dark section (`#0b0c0e`) for
  hard boundaries, flat grounds elsewhere.
- **Moment (`pinned-chapters`)**: three-step execution walkthrough pinned beside
  its live trace visual in `#how`.
- **Footer (`footer-dark` + `close-word`)**: combined closing CTA, oversized
  `Openmi` wordmark, link columns, legal row, and theme switcher on `#0b0c0e`.

## 2. Contrast & accessibility

- `node scripts/check-contrast.mjs` must pass at 4.5:1+ for every semantic pair
  across Paper (`:root`), Obsidian (`html.dark`), and Slate (`html.ink`).
- `:focus-visible` renders an instant `2px` cobalt ring with zero transition.
- `prefers-reduced-motion: reduce` disables all motion cleanly.

## 3. Anti-AI-slop rules

Pinned in `tests/design-tells.test.ts`:

- Never use Fraunces, purple/lavender themes, gradient-clipped headline text,
  or radial glow backdrops.
- Never draw fake macOS traffic-light dots (`.preview-dots`), pulsing status
  dots (`badge-pulse`), or rainbow animated input borders (`Beam`).
- Never use icon-in-a-box feature grids, tracked uppercase section eyebrows,
  staggered scroll fade-ins, or slop copy (`unlock`, `seamless`, `honest`).
- Never claim unobserved test runs, builds, or deployments.
