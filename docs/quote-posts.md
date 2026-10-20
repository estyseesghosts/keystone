# Keystone: Quote Post Rendering and Composition

**Audience:** implementation agents working on Keystone's SolidJS frontend  
**Status:** frontend implementation guide  
**Reviewed:** 16 October 2026

## Goal

Make quote posts work consistently against local Misskey, Sharkey, and Pinetree backends. Upstream servers may send different ActivityPub quote formats, and many will not send FEP-044f authorization metadata at all. Pinetree normalizes supported structured ActivityPub formats into one domain relationship and the Misskey-shaped `renote` / `renoteId` API relationship; Keystone normalizes the backend response and textual fallback into one frontend quote-target shape. Keystone must display the quoted Note as a quote card, and **must not suppress it because authorization is absent, pending, unapproved, rejected, or revoked**.

Keystone must also recognize a textual fallback such as `RE: https://example.social/notes/123`, even if the text was written by the user rather than injected by a server. This is a display heuristic, not proof that the post is a formal quote or has been authorized.

## Before editing

Read `AGENTS.md`, `solidjs.md`, `docs/api-surface.md`, `docs/frontend-plan.md`, and the current note/timeline implementation. Respect the existing project constraints:

- SolidJS 1.x and the existing Vite SPA only; no React, SSR, UI framework, global state library, or new component library.
- Reuse the typed `apiCall` helper and the established Misskey/Sharkey/Pinetree backend selection.
- Reuse the existing `NoteCard` / note detail structure and safe MFM renderer. Do not use `innerHTML` or render untrusted ActivityPub HTML directly.
- Keep loading, unavailable, and API-error states consistent with the rest of the UI.
- Do not modify the user's note text on the server merely to make a card render.

## Product decisions

1. **Render structured quotes regardless of authorization.** `pending`, `unapproved`, `rejected`, and `revoked` are not render filters. If the quoted Note is available to the current viewer, render it.
2. **Respect visibility.** Rendering regardless of quote authorization does not mean bypassing the backend's visibility controls. Never fetch protected content directly or show cached private content to an unauthorized viewer.
3. **Render textual `RE:` fallbacks.** An ending `RE: <HTTP(S) URL>` may be interpreted as a quote-card candidate regardless of whether a server generated it or the author typed it. The URL must resolve to a Note before rendering a full card; otherwise retain the ordinary text/link fallback.
4. **Structured relationship wins.** Prefer `renote` / `renoteId` from the API. If a matching `RE:` suffix is also present, render one card, not two. If the structured target and textual URL conflict, display the structured target and leave the text intact unless a safe, exact duplicate can be suppressed.
5. **Never label an unapproved quote as approved.** If Pinetree provides `quoteAuthorizationStatus`, it can inform a small status label, but must not gate rendering. A missing status is normal for Misskey/Sharkey and for legacy quotes from servers without FEP-044f support; it does not mean `rejected`.
6. **No recursive embed explosion.** Quote cards should use a compact Note preview. Do not recursively expand an unlimited chain of quotes.

## Note shape and detection order

### Structured Misskey-format quote

Misskey-family APIs represent a note with a quoted note through `renoteId` and a `renote` object. A quote retains its own authored content; a pure renote generally does not have independent commentary. Both relationships may coexist with `replyId` / `reply`—do not confuse a quote with a reply.

Use one normalization helper rather than scattering backend-specific checks across components. It is the boundary between backend response shapes and the UI: map every supported structured quote representation the selected backend exposes, plus a recognized textual fallback, into the same `QuoteTarget`; rendering components consume only that normalized shape and do not parse raw ActivityPub. For example:

```ts
type QuoteTarget = {
  noteId?: string;
  uri?: string;
  targetUnavailable?: boolean;
  source: "structured" | "textual-fallback";
  authorizationStatus?:
    | "pending"
    | "approved"
    | "rejected"
    | "revoked"
    | "unapproved"
    | "unknown";
};

function getQuoteTarget(note: Note): QuoteTarget | null {
  // 1. Normalize the backend's structured quote relationship and status.
  // 2. Distinguish a quote with authored content from a pure renote.
  // 3. Only if no structured quote exists, inspect a terminal RE: URL suffix.
  // Do not treat every URL in a note as a quote.
}
```

Adapt the type to the actual API types and coding conventions; this is an interface sketch, not a mandate to add a second state store. Keep backend-specific field interpretation inside the normalizer, and make its output the single source of truth for quote-card rendering. Preserve a known target URI even if its Note cannot be loaded, so the UI can show a safe unavailable/fallback state instead of losing the quote relationship. When Pinetree supplies `quoteTargetUri`, normalize it to `uri`; when it supplies `quoteTargetUnavailable`, normalize that to `targetUnavailable`. Never expose or fetch a protected target URI merely to complete the card.

Pinetree may include the non-standard, optional `quoteAuthorizationStatus` field. Treat it as display metadata only. Never assume Misskey/Sharkey return it. Never map “no authorization field” to “rejected”: for recognized legacy quotes, authorization evidence is often simply absent because the remote server does not implement FEP-044f. Normalize that case as unknown/unverified for display purposes, not as an explicit rejection. Also note that an explicit FEP-044f `Reject` is normally sent to the quote author; a recipient such as Pinetree cannot infer a third party’s explicit rejection merely from an absent stamp.

### Textual `RE:` fallback

When no structured quote target exists, parse the note's own text for a
**leading or terminal** fallback such as:

- `RE: https://example.social/notes/123`
- a leading `RE:` line above the commentary, or a final `RE:` line
  separated from commentary by a newline;
- a recognized final HTML fallback already converted to text by the backend.

Do not require a special class like `quote-inline`, a marker that the server generated it, or an API field identifying it as a fallback. User-authored `RE:` text is intentionally in scope.

Keep the heuristic narrow: recognize a leading or ending `RE:` followed by one absolute `http` or `https` URL on its own line, trim surrounding whitespace and ordinary trailing punctuation, and reject malformed URLs, credentials in URLs, and non-web schemes. Do not convert an arbitrary mid-sentence link or every URL into a quote. If markers appear at both ends with different URLs, the terminal suffix feeds the fallback card and each marker is suppressed only when its own card (or the matching structured card) renders — never two cards from one line pair. If there are multiple possible suffixes, use the final valid terminal suffix only. The regex/parser should operate on the note's text representation, not arbitrary remote HTML.

A textual fallback has no ActivityPub authorization semantics. Parsing it in Keystone must not change the note sent to the backend, synthesize an authorization stamp, or cause a request to be sent to the quoted author.

## Resolving a fallback URL

1. Reuse an already-loaded note if its canonical ID or URL matches.
2. Otherwise call the configured backend's existing `ap/show` endpoint through `apiCall` with the URI. Do not issue direct cross-origin `fetch` calls from the browser.
3. Accept a result as a quote card only if it resolves to a Note. A User, invalid object, failed resolution, inaccessible/private target, or deleted target is not a Note card.
4. On unresolved/inaccessible targets, retain the original `RE:` text as a clickable link or a compact unavailable state. Do not silently remove the text.
5. Cache in-flight and completed lookups by normalized URI to avoid duplicate requests during SolidJS reactivity, timeline updates, or repeated cards. Bound the cache and handle errors without retry loops.

Do not bypass server visibility to make the card look complete. Pinetree's `ap/show` and note API must make the access decision. A URL in a post is not a grant of permission to view the target.

## Rendering rules

### Quote with commentary

Render the quote author's normal Note content first, then a nested compact quoted-Note card. Include the quoted author's identity and note text, with existing CW, media, and unavailable states where practical. The embedded card should open the quoted Note detail route.

### Pure renote

Preserve the current pure-renote presentation. Do not label every `renote` as a quote; use the Note's own content/attachment fields and/or the Pinetree status extension to distinguish quote commentary from a plain renote.

### Fallback quote

If a terminal `RE:` suffix resolves, render it as a compact quote card. Suppress that exact suffix from the displayed body only when the card rendered successfully and the suffix is the card's source. This is a view transformation only; do not mutate persisted text. When resolution fails, keep the `RE:` line visible so the post still has its textual fallback.

If `renote` already provides a structured target, do not render a second fallback card. If the fallback URL matches the structured target, the duplicate suffix may be hidden in the UI; only suppress the exact matched suffix, not other user content.

### Rejected, unapproved, pending, and revoked

Always render the target card whenever the target Note is accessible. Do not gate on any `quoteAuthorizationStatus` value. If displaying status helps users understand the workflow, show a neutral label only when the API explicitly provides a status:

- `pending`: Quote request pending
- `rejected`: Quote request rejected
- `revoked`: Quote authorization revoked
- `unapproved` / `unknown`: Quote authorization unverified

Do not claim approval when the status is missing. Status labels are informational; they must not collapse or hide the quoted Note. Avoid displaying another user's private workflow data to everyone; where useful, scope rejection details to the quote author or otherwise use a neutral `not authorized` indicator.

The FEP-044f draft expects FEP-aware software to avoid displaying unapproved quotes in its non-normative security guidance. Keystone intentionally overrides that display recommendation. It should still present authorization state accurately when known and must not imply the authorization was granted.

### Replies and nesting

A Note can have both a reply parent and a quoted target. Keep `reply` context above/around the Note according to the current note-detail behavior, and render the quote card separately. Avoid infinite nesting: use a compact embedded Note view that doesn't expand its own quote/reply tree recursively; a click opens the full note route.

## Compose a structured quote

Add or wire a clear “Quote” action on a Note. It should open the existing composer with the selected target attached, while allowing the author to add their own text. Submit via the standard Misskey-compatible `notes/create` endpoint with `renoteId` set to the target ID and the user's authored text/visibility/media fields. Do not encode the quote by rewriting text as `RE:`; the structured `renoteId` is the intent.

- Keep this separate from a plain repost action, which remains a no-commentary renote.
- Preserve the selected quote target through composer editing, failed submissions, and retries.
- Clear it only on explicit removal/cancel or after successful creation.
- Replies use `replyId`; quotes use `renoteId`; the two can coexist if the backend supports it.
- Pinetree must generate the FEP-044f `QuoteRequest` workflow when the composed note is a structured quote. Keystone should not implement the federation workflow itself.
- Misskey/Sharkey may have different authorization behavior; gracefully use their existing Misskey-family API semantics without pretending they expose Pinetree's status field.

## API contract expected from Pinetree

For any recognized structured incoming/outgoing quote that the viewer may access, regardless of which supported ActivityPub field carried it and regardless of whether FEP-044f authorization metadata exists, Pinetree returns a standard Misskey-like note:

- quote post content stays on the outer Note;
- `renoteId` and `renote` refer to the quoted Note when it is resolved and safe to expose;
- when the target is unresolved, optional `quoteTargetUri` preserves a safe-to-disclose target URI, or `quoteTargetUnavailable` signals that the relationship exists but its target cannot safely be exposed; do not invent a `renoteId`;
- quote status is not used to remove those fields;
- optional `quoteAuthorizationStatus` communicates Pinetree's known status;
- inaccessible target data is omitted or represented as unavailable without leaking protected note details.

Pinetree recognizes ActivityPub `quote`, `_misskey_quote`, `quoteUrl`, `quoteUri`, and FEP-e232 Link markers at the federation boundary. Keystone does not need to parse raw ActivityPub payloads. Textual fallback detection is a separate client-side best-effort path.

## Testing and acceptance criteria

### Structured relationship

- A quote with commentary displays commentary plus exactly one quote card.
- A plain renote still looks like a repost, not a quote with empty commentary.
- `renoteId` and `renote` work when the quoted Note is local or remote.
- A reply and a quote on the same Note don't overwrite each other.
- If the API supplies both a structured target and an equivalent `RE:` suffix, only one quote card appears.

### Authorization independence

- Pinetree Note with `pending`, `unapproved`, `rejected`, `revoked`, `unknown`, or `approved` state renders the card if target is accessible.
- The same quote target arriving through each supported ActivityPub format, passing through Pinetree's normalization and API, reaches one frontend `QuoteTarget` and renders through the same card path. Include legacy-only payloads with no authorization, policy, or request fields.
- A rejected quote returned by Pinetree still renders. Missing status from Misskey/Sharkey doesn't hide a quote. A client must not infer `rejected` from the absence of `quoteAuthorizationStatus` or `quoteAuthorization`.
- Status labels never claim approval on the basis of a missing stamp or a text fallback.

### Textual fallback

- A user-authored terminal `RE: https://...` resolves and renders a card.
- A server-generated fallback is also recognized without requiring a special CSS marker.
- Failed lookup retains the original `RE:` text/link and shows no blank card.
- A random inline URL, malformed URL, `javascript:`/`data:` URL, or non-terminal `RE:` doesn't produce a quote card.
- If a fallback target disagrees with the structured `renote`, structured metadata wins without silently changing the note body.

### Visibility and reliability

- A private/inaccessible quote target never appears merely because its URL is present in the post.
- Deleted, missing, non-Note, or unavailable targets produce a stable fallback; Pinetree's `quoteTargetUri` and `quoteTargetUnavailable` normalize into the same `QuoteTarget` without leaking protected target URIs.
- Lookups are deduplicated and don't loop on repeated renders or timeline updates.
- `npm run build` stays green; test against the real local Misskey, Sharkey, and Pinetree backends, not just static fixtures.

## Sources

- [FEP-044f: Consent-respecting quote posts](https://fep.swf.pub/fep/044f/fep-044f.html) — `quote`, textual fallback, approval/rejection/revocation and policy semantics.
- [Misskey ActivityPub extensions](https://misskey-hub.net/ns/) — legacy `_misskey_quote` meaning.
- [Current Misskey quote parser](https://github.com/misskey-dev/misskey/blob/develop/packages/backend/src/core/activitypub/models/ApNoteService.ts) and [renderer](https://github.com/misskey-dev/misskey/blob/develop/packages/backend/src/core/activitypub/ApRendererService.ts).
- [Keystone README](https://github.com/estyseesghosts/keystone/blob/main/README.md), [AGENTS.md](https://github.com/estyseesghosts/keystone/blob/main/AGENTS.md), and [`docs/frontend-plan.md`](https://github.com/estyseesghosts/keystone/blob/main/docs/frontend-plan.md).
- [Pinetree `AGENTS.md`](https://github.com/estyseesghosts/pinetree/blob/master/AGENTS.md) and [domain Note model](https://github.com/estyseesghosts/pinetree/blob/master/src/domain/note.rs).
