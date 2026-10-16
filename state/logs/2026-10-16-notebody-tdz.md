# 2026-10-16 — NoteBody memo TDZ crash (feeds down)

Owner symptom: signed in on dvd.chat, no feed renders anywhere; console:
`ReferenceError: Cannot access 'coveredMarkers' before initialization`
at `NoteBody.tsx:283`.

Root cause (mine, from the leading-`RE:` change): `strippedUris` /
`cardUrls` were declared ABOVE `coveredMarkers`, and Solid memos compute
eagerly on creation — the initial computation read a `const` still in its
temporal dead zone, so every `NoteBody` setup threw and no note could
render. `tsc` and the build cannot catch this (runtime ordering only);
the 45/45 pure-module checks don't execute component setup either.

Fix: declare `textMarkers` → `coveredMarkers` → `strippedUris` →
`cardUrls` → `visibleText` top-down, with a comment stating the
constraint. Audited the session's other new memos (TranslatableText
`decision` → `displayText` → `folded`, NoteCard `tags`, QuoteHead):
all already top-down.

Also added (previous commit `0d3659e`): 30s AbortController timeout on
`postJson`/`postDirect` so any genuinely hung request surfaces as a
named, retryable error instead of eternal skeletons.

Unrelated noise in the same console: `POST /api/meta 500` is the
internal proxy path hitting the dead `:3000` (no local backend on this
rig) — caught and non-fatal; external traffic goes direct.
