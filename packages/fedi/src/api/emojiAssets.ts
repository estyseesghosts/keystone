// Resolution of Unicode emoji to version-pinned remote SVG assets for the
// selectable emoji styles. Manifests are intentionally not shipped as full
// artwork; only URL templates and code-point conversion live here. Styles that
// need a metadata-based manifest (Fluent) return null until a manifest is
// available, and the renderer falls back to the original Unicode sequence.

export type EmojiStyle =
  | "openmoji"
  | "twemoji"
  | "noto"
  | "fluent"
  | "system";

export const EMOJI_STYLES: EmojiStyle[] = [
  "openmoji",
  "twemoji",
  "noto",
  "fluent",
  "system",
];

export const DEFAULT_EMOJI_STYLE: EmojiStyle = "openmoji";

export const EMOJI_STYLE_STORAGE_KEY = "keystone_emoji_style";

/** Validated parse: anything unknown falls back to the default (openmoji). */
export function parseEmojiStyle(raw: string | null): EmojiStyle {
  return raw === "openmoji" ||
    raw === "twemoji" ||
    raw === "noto" ||
    raw === "fluent" ||
    raw === "system"
    ? raw
    : DEFAULT_EMOJI_STYLE;
}

const OPENMOJI_VERSION = "17.0.0";
const TWEMOJI_VERSION = "v17.0.3";
const NOTO_VERSION = "v2026-09-24-unicode18_0";
const FLUENT_COMMIT = "1ffb34c752ecf5d402f04cfb4b392c77f57c54bc";

/** Lowercase hyphen-joined hex (Twemoji convention). */
export function twemojiName(sequence: string): string {
  return Array.from(sequence)
    .map((c) => (c.codePointAt(0) as number).toString(16))
    .join("-");
}

/** Uppercase hyphen-joined hex (OpenMoji convention). */
export function openmojiName(sequence: string): string {
  return Array.from(sequence)
    .map((c) => (c.codePointAt(0) as number).toString(16).toUpperCase())
    .join("-");
}

/** Lowercase underscore-joined hex with emoji_u prefix (Noto convention). */
export function notoName(sequence: string): string {
  return "emoji_u" + Array.from(sequence).map((c) => (c.codePointAt(0) as number).toString(16)).join("_");
}

export function openmojiUrl(sequence: string): string {
  return `https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@${OPENMOJI_VERSION}/color/svg/${openmojiName(sequence)}.svg`;
}

export function twemojiUrl(sequence: string): string {
  return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@${TWEMOJI_VERSION}/assets/svg/${twemojiName(sequence)}.svg`;
}

export function notoUrl(sequence: string): string {
  return `https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@${NOTO_VERSION}/2D/svg/${notoName(sequence)}.svg`;
}

/**
 * Resolve a safe, version-pinned URL for the given style and sequence, or
 * null when the style renders via the system font or the sequence is not
 * supported by a remote manifest.
 */
export function resolveEmojiUrl(style: EmojiStyle, sequence: string): string | null {
  if (style === "system") return null;
  if (sequence.length === 0) return null;
  switch (style) {
    case "openmoji":
      return openmojiUrl(sequence);
    case "twemoji":
      return twemojiUrl(sequence);
    case "noto":
      return notoUrl(sequence);
    case "fluent":
      // Fluent requires a metadata-based manifest; not derived here.
      return null;
  }
  return null;
}

export function isRemoteEmojiStyle(style: EmojiStyle): boolean {
  return style !== "system";
}