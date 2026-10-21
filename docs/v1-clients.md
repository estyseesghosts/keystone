# v1 reference carry: clients.md
> Source: /Users/terezi/Local Documents/Keystone/docs/clients.md
> Carried: 2026-10-21 — verbatim copy (this header added).
> Reference only — v2 requirements live in docs/parity-gaps.md.

---

# Keystone clients — web (desktop + mobile) vs native mobile app

Status: Living (2026-10-19)

Keystone has **two client codebases** serving **three client surfaces**.
The three surfaces share product language (minimalist black/white/grey feed)
but nothing else: no shared components, no shared styles, no shared state.

| Surface | Codebase | Stack | Status |
|---|---|---|---|
| Desktop web | `frontend/` | SolidJS SPA (Vite) | The product; slices 0–3 built, Misskey + Mastodon families |
| Mobile web | `frontend/` (same code, responsive) | Same SPA at narrow widths: single column, bottom nav, 44–48px targets, `viewport-fit=cover` | Same product, same build, no separate codebase |
| Native mobile app | `mobile/` | SolidJS + SymbioteNative (real native views, Metro) | **Feasibility prototype** (spec `mobile_2.md`); fixture data only |

## What "separate" means in practice

- **Desktop web and mobile web are one thing.** There is no mobile-web fork,
  no `frontend-mobile/` tree, no user-agent sniffing that swaps
  implementations. Narrow viewports get the same routes and components with
  responsive CSS (`docs/mobile.md` records the Slices B–F pass). A bug fixed
  in `frontend/src/components/TimelineFeed.tsx` is fixed on phones and
  desktops alike.
- **The native app is not a wrapper.** `mobile/` renders through
  `@symbiote-native/engine` to real iOS/Android views — never a WebView, never
  the SPA in a shell. It must never import from `../frontend/` (components,
  routes, styles, router); portable pure logic may be copied behind a native
  adapter only after its import chain is inspected (see `mobile/AGENTS.md`
  §3). The dependency goes one way and today it is zero: Phase 2 uses
  fixture data only, no networking, no auth, no credential storage.
- **No installable-PWA packaging exists today.** Neither web surface ships a
  manifest or service worker (verified 2026-10-19: no `manifest.*`,
  `service-worker`, or Workbox reference in `frontend/`). "Mobile web" above
  means the responsive SPA in a mobile browser. If installability (add to
  home screen, offline shell) becomes a goal, that is new work on `frontend/`
  — it does not come from `mobile/`, and building it must not entangle the
  native prototype.
- **Packaging stays isolated.** `frontend/` uses npm + Vite; `mobile/` uses
  pnpm + Metro with its own lockfile. Never hoist or merge them.

## Where things live

- Web product, scope, and verification: `keystone.md`, `docs/frontend-plan.md`.
- Native prototype spec (all phases + acceptance bar): `docs/mobile_2.md`.
- Native prototype plan, setup, and per-phase records: `mobile/docs/`
  (start at `mobile/docs/README.md`).
- Mobile-only agent rules (wins inside `mobile/`): `mobile/AGENTS.md`.
- Session resume pointer: `state/STATE.md`.

## Non-goals (explicit)

- No React Native port of the web SPA, no shared component library, no
  monorepo tooling across the two clients.
- The prototype never becomes a second Keystone by accident: fixture data
  stays in `mobile/src/fixtures/`, is always labelled as such in the UI, and
  production reuse is a Phase 6 decision (`docs/mobile_2.md` §8), not a
  background refactor.

## End goal: one shared component codebase on portable primitives (owner, 2026-10-19)

The long-term goal is the Bluesky model: **one component codebase that
renders natively on phones and to DOM on web** — not a WebView wrapper, and
not two implementations. Concretely:

- **Portable primitives** = components speak only a vocabulary that exists
  on every target (`View`, `Text`, `Image`, `TextInput`, `Pressable`,
  `ScrollView`/`FlatList`, style objects) — never `div`, never `UIView`,
  never CSS files, never `window`. One backend per platform translates the
  vocabulary (SymbioteNative already is the native backend; the web backend
  is the piece to build). Bluesky does exactly this with React Native +
  `react-native-web`; the ~95% shared / ~5% platform-split (`Platform.select`,
  `*.native`/`*.web` leaves) ratio is the target, paid for by living inside
  the lowest common denominator (no CSS grid, no `:hover`-dependent UI).
- **What already shares for free:** Solid signals/stores (identical on both
  renderers), `fetch`, `mfm-js` parsing, time formatting, domain types, API
  clients — plain TypeScript with no DOM dependency. This is the Phase 6
  scope and it is unaffected by anything below.
- **What it will actually take:** (1) a tiny `@keystone/ui` primitives
  package with two backends (DOM resolved on web, SymbioteNative intrinsics
  on mobile — package export conditions, one import path in app code);
  (2) a style system that compiles both ways (today's CSS files do not
  transfer); (3) a portable navigation abstraction (Stack push/pop natively,
  path routes on web); (4) porting all ~70 DOM components onto that
  vocabulary with no DOM-only escapes, enforced by lint. No abandoning
  Solid: `solid-js/web` and the universal custom renderer can share
  component *sources* as long as the sources stay inside the vocabulary.
- **What this means for today's work:** the "SPA unchanged" rule stays in
  force through the prototype phases, and the hybrid WebView model stays an
  *evaluated alternative* (Phase 4 report), not the goal. Phase 2/3 exist to
  prove the native renderer is worth committing to *before* betting the
  product on the port — and they are already mapping the exact seams (media,
  keyboard, transitions, list behavior) where the primitive set must be
  solid. The shared-primitives program starts after that decision, not
  during it.
