# ADR index

Load-bearing decisions. Numbered, append-only, never renumbered.

| ADR                      | Title                     | Date | Status |
| ------------------------ | ------------------------- | ---- | ------ |
| [0000](0000-template.md) | Template (not a decision) | —    | —      |
| [0001](0001-patterns-not-code.md) | Patterns, not code (Bluesky reference use) | 2026-10-20 | accepted |
| [0002](0002-butterfly-tarantula.md) | Two UI layouts: butterfly and tarantula | 2026-10-20 | accepted |
| [0003](0003-oauth-scopes-now-vs-later.md) | OAuth scopes: SCOPES_NOW vs SCOPES_LATER | 2026-10-22 | accepted |
| [0004](0004-document-picker.md) | Document picker module for import files | 2026-10-22 | accepted |
| [0005](0005-per-flavor-oauth-scopes.md) | Per-flavor OAuth scope strings (Mastodon triple, Akkoma full) | 2026-10-22 | accepted |
| [0006](0006-recommendations-feed.md) | Fork recommendations feed (dvd-sharkey port) | 2026-10-24 | accepted |
| [0007](0007-nullable-notification-created-at.md) | Nullable `Notification.createdAt` (never fake dates) | 2026-10-24 | accepted |
| [0008](0008-sdk-57-pin.md) | Pin SDK 57 native deps, drop Bluesky-mirror overrides | 2026-10-24 | accepted |
| [0009](0009-misskey-server-info-nulls.md) | Nullable `MisskeyServerInfo` fields (never invent hardware numbers) | 2026-10-24 | accepted |
| [0010](0010-poll-id-on-model.md) | Poll id on core `Poll` (delete the Mastodon vote GET-then-POST) | 2026-10-25 | accepted |
| [0011](0011-token-storage.md) | Native secret-free envelope: SecureStore vault + in-memory token map, web unchanged dev-grade | 2026-10-25 | accepted |
| [0012](0012-miauth-callback-risk.md) | MiAuth `keystone://` callback: accepted interception risk + mitigations | 2026-10-25 | accepted |
| [0013](0013-poll-hidden-totals.md) | Poll hidden totals: PollOption.votesCount nullable | 2026-10-25 | accepted |

## When to write one

Framework choice, data-model shape, auth/storage approach, dependency
swap with wide blast radius, dropped target, or anything reversing
`rn-rebuild-plan.md`. Small swaps go in `../DECISIONS.md` as one-liners;
promote to ADR when consequences are wide.
