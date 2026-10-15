# 2026-10-15 — Router + MFM docs (version-pending drafts)

**Goal:** version-matched `@solidjs/router` + `mfm-js` AST notes, split as
two files, drafted now with versions pinned later (owner choice).
Refs: `keystone.md` §§8,10, `solidjs.md`, `AGENTS.md` §§1,7, `docs/api-surface.md`.

## What changed

- Created `docs/router.md` (Status: Draft, versions TBD): fixed 6-route table,
  `<Router root={App}>` + `<A>` pattern marked to-verify, auth gating via
  `<Show>`, layout, anti-patterns, per-route verification.
- Created `docs/mfm.md` (Status: Draft, versions TBD): v1 allow-list
  (text, bold/italic/strike, code, quote, link/mention/hashtag), no-`innerHTML`
  + safe-text fallback + safe-link + packed-emoji-only rules, AST validation
  procedure against installed `*.d.ts` (no type/props asserted until pinned).
- Updated `docs/README.md` index (added both files).
- Updated `state/STATE.md` (current task, next actions, blockers).

Deliberately asserted no version numbers, no AST type/property names, and no
router export signatures — all marked TBD pending Slice 0 scaffold, per
`keystone.md` §10 ("validate against installed definitions").

## Evidence

- `git -C pinetree rev-parse --short HEAD` → `ff651d6` (re-checked; unchanged).
- `ls frontend` → No such file or directory (`not yet verified` — nothing to build; version pins blocked on scaffold).
- Files written, not yet executed: `not yet verified` (`npm run build` n/a, no frontend).

## Open questions / next step

- `AGENTS.md` §7 (black/white/grey, no accent) vs `keystone.md` §2 (pine-green
  accent) noted in `docs/router.md`; needs reconciliation before styling slice.
- Next: Slice 0 scaffold per `keystone.md` §3, then fill Version pin sections
  in both docs from `frontend/package.json` + installed `*.d.ts` grep output.
