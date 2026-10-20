// Custom-emoji code helpers for the Misskey family.
//
// Ported from old Keystone `frontend/src/api/emoji.ts` (only what the
// Misskey adapter needs — the full picker/grouping surface stays with the
// UI-side port): reaction-key shapes, `:name:` / `:name@host:` parsing,
// and the listing item type. All pure.

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

/** Parsed `:name:` / `:name@host:` code (colons optional on input). */
export interface ParsedEmojiCode {
  /** Full canonical code (`:name:` / `:name@host:`). */
  code: string;
  /** Bare emoji name (no host). */
  name: string;
  /** Host qualifier, or null for local codes. */
  host: string | null;
  /** True when the code names a remote host's emoji. */
  remote: boolean;
}

const EMOJI_CODE_PATTERN = /^:([A-Za-z0-9_+-]+(?:@([A-Za-z0-9.-]+))?):$/;

export function parseEmojiCode(code: string): ParsedEmojiCode | null {
  const match = EMOJI_CODE_PATTERN.exec(code.trim());
  if (!match) return null;
  const name = match[1].split("@")[0];
  const host = match[2] ?? null;
  if (!name || (match[2] !== undefined && match[2].length === 0)) return null;
  const remote = !isLocalEmojiHost(host);
  return { code: remote ? `:${name}@${host}:` : `:${name}:`, name, host, remote };
}

/** Local hosts: absent, empty, or the `.` local marker. A fully-qualified
 * `@own-host` code counts as remote here (it resolves through the
 * per-host cache, which hits the same instance). Pure. */
export function isLocalEmojiHost(host: string | null | undefined): boolean {
  return host == null || host === "" || host === ".";
}

/** `:inner:` → `inner` (trimmed, non-empty), else null. Pure. */
export function stripEmojiColons(code: string): string | null {
  const match = /^:(.+):$/.exec(code.trim());
  if (!match) return null;
  const inner = match[1].trim();
  return inner.length > 0 ? inner : null;
}

/** `name@host` / `name@.` → `name`. The `@.` marker means local. Pure. */
export function bareEmojiName(inner: string): string {
  const at = inner.indexOf("@");
  return at < 0 ? inner : inner.slice(0, at);
}

/** Bare emoji name for a reaction key (`:name:` / `:name@host:`), or null
 * for unicode reactions and malformed codes. Pure. */
export function customEmojiNameFromReaction(reaction: string): string | null {
  const inner = stripEmojiColons(reaction);
  if (inner == null) return null;
  const bare = bareEmojiName(inner);
  return /^([A-Za-z0-9_+-]+)$/.exec(bare)?.[1] ?? null;
}
