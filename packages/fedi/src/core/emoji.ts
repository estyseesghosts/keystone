// Tolerant packed-emoji lookup shared by the adapter and the app.
//
// Reaction keys are `:name:` / `:name@host:` (colons optional on input).
// Packed per-object maps (`reactionEmojis`, `emojis`) may be keyed bare
// (`name@host`) or colon-wrapped (`:name@host:`) depending on the
// server/version; both shapes resolve. Lookup order: exact key, then bare
// `name@host`, then `name` (local codes only fall back to the bare name;
// a remote code never resolves to a different host's art, so a local
// lookalike is never shown for a remote code). Pure: no imports.

/** `:inner:` -> `inner` (trimmed, non-empty), else null. Pure. */
function stripEmojiColons(code: string): string | null {
  const match = /^:(.+):$/.exec(code.trim());
  if (!match) return null;
  const inner = match[1].trim();
  return inner.length > 0 ? inner : null;
}

/** `name@host` / `name@.` -> `name`. The `@.` marker means local. Pure. */
function bareEmojiName(inner: string): string {
  const at = inner.indexOf("@");
  return at < 0 ? inner : inner.slice(0, at);
}

function pickUrl(packed: Record<string, string>, key: string): string | null {
  const url = packed[key];
  return typeof url === "string" && url.length > 0 ? url : null;
}

/** Resolve a code against a packed per-object map (`reactionEmojis`,
 * `emojis`): exact key first, then the bare inner (`name@host`), then —
 * for LOCAL codes only (`:name:`, `:name@.:`) — the bare name. Each step
 * accepts both the bare and the colon-wrapped packed shape. Remote codes
 * (`:name@host:`) never fall back to the bare name: a packed bare key is
 * a *local* emoji and rendering it under a remote code would show the
 * wrong image. Accepts the code with or without surrounding colons.
 * Pure. */
export function lookupPackedEmojis(
  packed: Record<string, string> | null | undefined,
  code: string,
): string | null {
  if (!packed) return null;
  const trimmed = code.trim();
  if (trimmed.length === 0) return null;
  // 1. Exact key as given (covers either packed shape when it matches).
  const exact = pickUrl(packed, trimmed);
  if (exact != null) return exact;
  // 2. Bare `name@host` inner, in both packed shapes.
  const inner = stripEmojiColons(trimmed) ?? trimmed;
  if (inner !== trimmed) {
    const url = pickUrl(packed, inner);
    if (url != null) return url;
  }
  const wrapped = `:${inner}:`;
  if (wrapped !== trimmed) {
    const url = pickUrl(packed, wrapped);
    if (url != null) return url;
  }
  // 3. Bare `name` — local codes only.
  const at = inner.indexOf("@");
  const host = at < 0 ? "" : inner.slice(at + 1);
  const local = host === "" || host === ".";
  if (!local) return null;
  const bare = bareEmojiName(inner);
  if (bare !== inner) {
    const url = pickUrl(packed, bare);
    if (url != null) return url;
    const bareWrapped = `:${bare}:`;
    if (bareWrapped !== trimmed && bareWrapped !== wrapped) {
      const fallback = pickUrl(packed, bareWrapped);
      if (fallback != null) return fallback;
    }
  }
  return null;
}
