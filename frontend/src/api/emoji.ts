// Emoji picker data + device-local list helpers. All pure (unit-checked).
//
// Two emoji kinds flow through the picker:
// - Unicode presets: client-side, no server dependency. `QUICK_REACTIONS`
//   is the reaction picker's quick row (hearts live on the like button,
//   so they are excluded here); `COMPOSER_EMOJI` is the insert pool.
// - Custom emoji: `:name:` codes with packed image URLs from
//   `POST /api/emojis` (`{emojis: [{name, category, url, aliases}]}`,
//   verified live on Sharkey dvd.chat 2026-10-16 — public, no auth).
//   Unknown `:code:` strings are never resolved to fabricated URLs:
//   without a packed URL they render as literal text.

/** The like reaction. The server normalizes ❤️ (U+2764 U+FE0F) to ❤
 * (U+2764), so the normalized form is canonical — optimistic client
 * state then matches the reconciled server state exactly. */
export const HEART_REACTION = "❤";

export function isHeartReaction(reaction: string | null): boolean {
  return reaction === "❤" || reaction === "❤️";
}

/** Whether the like button counts as active for the viewer's reaction:
 * the same emoji (bare `:name:` and local `:name@.:` compare equal),
 * or either heart form when the configured like is itself a heart
 * (covers ❤️→❤ server normalization). A legacy heart under a custom
 * like reads as unliked: clicking it upgrades the reaction via the
 * usual delete-then-create path. */
export function isLikeActive(
  likeEmoji: string,
  myReaction: string | null,
): boolean {
  if (myReaction == null) return false;
  if (sameEmojiKey(myReaction, likeEmoji)) return true;
  return isHeartReaction(myReaction) && isHeartReaction(likeEmoji);
}

/** Chip-row exclusion: hearts always (they live on the like button),
 * plus the configured custom like emoji (owner decision 2026-10-16:
 * the chosen like never appears as a chip either). Local `:name@.:`
 * and bare `:name:` compare equal; distinct remote hosts never do. */
export function shouldHideChip(key: string, likeEmoji: string): boolean {
  return isHeartReaction(key) || sameEmojiKey(key, likeEmoji);
}

/** Chips-row entries: every reaction with a positive count except the
 * like-kind ones (see `shouldHideChip`), sorted by count descending.
 * Tolerates a null/undefined map (servers can transiently pack one). */
export function visibleReactions(
  reactions: Record<string, number> | null | undefined,
  likeEmoji: string = HEART_REACTION,
): [string, number][] {
  return Object.entries(reactions ?? {})
    .filter(([key, count]) => count > 0 && !shouldHideChip(key, likeEmoji))
    .sort((a, b) => b[1] - a[1]);
}

/** Reaction quick row (unicode only — no server dependency). */
export const QUICK_REACTIONS = ["👍", "😆", "🤔", "😮", "🎉", "💢", "😥", "😇", "🍮"];

/** Composer insert pool (unicode only — no server dependency). */
export const COMPOSER_EMOJI = [
  "😀", "😂", "🥲", "😉", "😮", "😢", "🤔", "🙏",
  "👏", "👍", "🔥", "❤", "🎉", "👀", "💯", "💭",
];

export interface CustomEmoji {
  name: string;
  category: string | null;
  url: string;
  aliases: string[];
}

/** Reaction key sent for a local custom emoji. Misskey-family servers
 * accept the `:name:` form for hosted emoji. */
export function customReactionCode(name: string): string {
  return `:${name}:`;
}

/** Extract the bare emoji name for GLOBAL-list lookup (`:name:` →
 * `name`). Host-qualified keys (`:name@host:`, `:name@.:`) reduce to
 * the bare name; unicode and anything else yield null. Packed
 * per-object maps prefer `lookupPackedEmojis` (exact inner first). */
export function customEmojiNameFromReaction(reaction: string): string | null {
  const inner = stripEmojiColons(reaction);
  if (inner == null) return null;
  const bare = bareEmojiName(inner);
  return /^([A-Za-z0-9_+-]+)$/.exec(bare)?.[1] ?? null;
}

// --- Custom-emoji key shapes (verified live on Sharkey dvd.chat) ---
//
// Reaction keys pack the host: `:name@host:` for remote emoji (the
// common case in the wild). Display names, text, and the global
// `emojis` listing use bare `:name:`. Packed per-object maps
// (`note.reactionEmojis`, `note.emojis`, `user.emojis`) are keyed by
// the BARE inner (`name@host`, no colons) → URL and are the
// authoritative source wherever the object is in hand (they cover
// remote emoji too); the global listing is the fallback.

/** `:inner:` → `inner` (trimmed, non-empty), else null. Pure. */
export function stripEmojiColons(code: string): string | null {
  const match = /^:(.+):$/.exec(code.trim());
  if (!match) return null;
  const inner = match[1].trim();
  return inner.length > 0 ? inner : null;
}

/** `name@host` / `name@.` → `name`. The `@.` marker means local, so
 * it compares equal to the bare name (see `sameEmojiKey`). Pure. */
export function bareEmojiName(inner: string): string {
  const at = inner.indexOf("@");
  return at < 0 ? inner : inner.slice(0, at);
}

function splitEmojiInner(inner: string): { name: string; host: string } {
  const at = inner.indexOf("@");
  return at < 0
    ? { name: inner, host: "" }
    : { name: inner.slice(0, at), host: inner.slice(at + 1) };
}

/** Whether two reaction keys denote the same emoji: exact match, or
 * bare `:name:` vs local `:name@.:`. Distinct remote hosts
 * (`:x@a:` vs `:x@b:`) never equate. Pure. */
export function sameEmojiKey(a: string, b: string): boolean {
  if (a === b) return true;
  const innerA = stripEmojiColons(a);
  const innerB = stripEmojiColons(b);
  if (innerA == null || innerB == null) return false;
  const pa = splitEmojiInner(innerA);
  const pb = splitEmojiInner(innerB);
  if (pa.name !== pb.name) return false;
  if (pa.host === pb.host) return true;
  const localA = pa.host === "" || pa.host === ".";
  const localB = pb.host === "" || pb.host === ".";
  return localA && localB;
}

/** Resolve a code against a packed per-object map (`reactionEmojis`,
 * `emojis`): tries the exact inner (`name@host`), the bare name, and
 * colon-wrapped variants (tolerant of either key shape). Accepts the
 * code with or without surrounding colons. Pure. */
export function lookupPackedEmojis(
  packed: Record<string, string> | null | undefined,
  code: string,
): string | null {
  if (!packed) return null;
  const trimmed = code.trim();
  if (trimmed.length === 0) return null;
  const inner = stripEmojiColons(trimmed) ?? trimmed;
  const bare = bareEmojiName(inner);
  const candidates = [inner, bare, `:${inner}:`, `:${bare}:`];
  for (const key of candidates) {
    const url = packed[key];
    if (typeof url === "string" && url.length > 0) return url;
  }
  return null;
}

export interface CustomEmojiGroup {
  category: string;
  items: CustomEmoji[];
}

/** Group custom emoji by category (null/blank → "Uncategorized"),
 * groups sorted alphabetically, items sorted by name. Pure. */
export function groupCustomByCategory(list: CustomEmoji[]): CustomEmojiGroup[] {
  const byCategory = new Map<string, CustomEmoji[]>();
  for (const emoji of list) {
    const category =
      emoji.category && emoji.category.trim().length > 0
        ? emoji.category
        : "Uncategorized";
    const group = byCategory.get(category);
    if (group) group.push(emoji);
    else byCategory.set(category, [emoji]);
  }
  return [...byCategory.entries()]
    .map(([category, items]) => ({
      category,
      items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

/** Substring filter over custom emoji names + aliases,
 * case-insensitive; surrounding colons are ignored so `:blob`
 * matches `blobcat`. Empty query returns the full list. Pure. */
export function filterCustomEmojis(
  list: CustomEmoji[],
  query: string,
): CustomEmoji[] {
  const q = query.trim().replace(/^:+|:+$/g, "").toLowerCase();
  if (q.length === 0) return list;
  return list.filter(
    (emoji) =>
      emoji.name.toLowerCase().includes(q) ||
      emoji.aliases.some((alias) => alias.toLowerCase().includes(q)),
  );
}

/** Substring filter over a unicode pool (typing the character itself
 * finds it). Empty query returns the pool. Pure. */
export function filterUnicode(pool: string[], query: string): string[] {
  const q = query.trim();
  if (q.length === 0) return pool;
  return pool.filter((emoji) => emoji.includes(q));
}

// --- Plain-text `:code:` splitting (display names, CWs, bios) ---
//
// Display names, content warnings, and (unfurl-card) bios are plain
// text, not MFM — but they can still carry `:code:` custom emoji.
// Splitter is pure (unit-checked); `DisplayName` in
// `components/EmojiPicker.tsx` renders the parts. Remote `:name@host:`
// codes never split (no packed URL is known for those).

export type NamePart =
  | { kind: "text"; text: string }
  | { kind: "emoji"; code: string };

/** Split `:code:` sequences out of plain text. Adjacent codes each
 * become their own part; everything else stays verbatim. */
export function splitNameEmojis(name: string): NamePart[] {
  const parts: NamePart[] = [];
  const pattern = /:([A-Za-z0-9_+-]+):/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(name)) !== null) {
    if (match.index > last) {
      parts.push({ kind: "text", text: name.slice(last, match.index) });
    }
    parts.push({ kind: "emoji", code: match[0] });
    last = match.index + match[0].length;
  }
  if (last < name.length) parts.push({ kind: "text", text: name.slice(last) });
  return parts;
}

// --- Device-local lists (favourites + recently used) ---
//
// Persisted as JSON string arrays in localStorage (see
// `state/emojiPrefs.tsx`). Device-local for now; per-account storage
// arrives with the Pinetree server work (owner decision 2026-10-16).

export const MAX_RECENTS = 24;
export const MAX_FAVOURITES = 60;

/** Validated parse of a stored emoji list: non-array/missing → [];
 * non-string/blank entries dropped; first-seen order kept; capped. */
export function parseStoredList(raw: string | null, max: number): string[] {
  if (raw == null || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "string") continue;
      const emoji = entry.trim();
      if (emoji.length === 0 || seen.has(emoji)) continue;
      seen.add(emoji);
      out.push(emoji);
      if (out.length >= max) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** MRU touch: the picked emoji moves to the front, capped. Pure. */
export function touchRecent(
  list: string[],
  emoji: string,
  max: number = MAX_RECENTS,
): string[] {
  const clean = emoji.trim();
  if (clean.length === 0) return list;
  return [clean, ...list.filter((entry) => entry !== clean)].slice(0, max);
}

/** Favourite add: stuck in user order (appended, never reordered by
 * use); duplicates are no-ops; capped. Pure. */
export function addFavourite(
  list: string[],
  emoji: string,
  max: number = MAX_FAVOURITES,
): string[] {
  const clean = emoji.trim();
  if (clean.length === 0) return list;
  if (list.includes(clean)) return list;
  return [...list, clean].slice(0, max);
}

/** Favourite remove. Pure. */
export function removeFavourite(list: string[], emoji: string): string[] {
  return list.filter((entry) => entry !== emoji);
}

// --- Like emoji setting ---

export const DEFAULT_LIKE_EMOJI = HEART_REACTION;
const MAX_LIKE_EMOJI_LENGTH = 64;

/** Validated parse of the stored like emoji: blank/missing/too-long
 * falls back to the heart. Accepts any unicode emoji or `:code:`. */
export function parseLikeEmoji(raw: string | null): string {
  if (raw == null) return DEFAULT_LIKE_EMOJI;
  const clean = raw.trim();
  if (clean.length === 0 || clean.length > MAX_LIKE_EMOJI_LENGTH) {
    return DEFAULT_LIKE_EMOJI;
  }
  return clean;
}
