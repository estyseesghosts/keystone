// Word-mute / hard-word-mute / instance-mute matching + editor transport.
//
// Matching mirrors Misskey's web client exactly (verified against the local
// misskey checkout: `packages/frontend/src/utility/check-word-mute.ts` and
// `checkNoteWordMute` in `packages/frontend/src/composables/use-note.ts`;
/// instance checks mirror `packages/backend/src/misc/is-instance-muted.ts`):
// - a user's own notes never match;
// - the haystack is CW + '\n' + text, trimmed (CW first, so `^` anchors at
//   the CW — text + CW order would mismatch anchored patterns);

import { FediError } from "../core/errors";
// - keyword matching is a case-SENSITIVE substring; empty keywords are
//   dropped from a group, and a group left empty never matches;
// - bare-string filters are `/pattern/flags` regular expressions (shared
//   instances reset `lastIndex`, so `g`-flagged patterns stay correct);
//   a wrong-shaped or invalid pattern never matches;
// - a note checks itself, then its reply, then its renote;
// - instance mutes are exact case-sensitive host matches over the author,
//   the reply author, and the renote author.
//
// The editor transport mirrors the reference settings form
// (`mute-block.word-mute.vue` `render`/`parseMutes`): arrays space-join
// onto one line (lines are ORed, words on a line are ANDed), bare regex
// strings stay verbatim lines (never space-split) and must compile — an
// invalid pattern aborts the save with the 1-based line number.

export type WordMuteFilter = string | string[];

export interface MuteCheckNote {
  userId: string;
  text: string | null;
  cw?: string | null;
  user: { host: string | null };
  reply?: MuteCheckNote | null;
  renote?: MuteCheckNote | null;
}

/** Core `Post` -> the matcher's structural input (the matcher itself is
 * Misskey-exact parity code over plain strings and stays untouched).
 * The haystack text is the MFM source where the family packs one
 * (Misskey always; Akkoma via `pleroma.content`), else the plain-text
 * projection (vanilla Mastodon has no MFM source — without the fallback
 * no server-side phrase could ever match those posts). Misskey notes
 * without text carry `plain: ""`, so Misskey matching is unchanged. */
export function muteCheckOf(post: import("../core/models").Post): MuteCheckNote {
  return {
    userId: post.accountId,
    text: post.content.mfm ?? post.content.plain ?? null,
    cw: post.cw,
    user: { host: post.author.host },
    reply: post.reply ? muteCheckOf(post.reply) : null,
    renote: post.renote ? muteCheckOf(post.renote) : null,
  };
}

const regexCache = new Map<string, RegExp | null>();

function compiledRegex(filter: string): RegExp | null {
  const cached = regexCache.get(filter);
  if (cached !== undefined) return cached;
  let out: RegExp | null = null;
  const parts = filter.match(/^\/(.+)\/(.*)$/);
  if (parts != null) {
    try {
      out = new RegExp(parts[1], parts[2]);
    } catch {
      out = null;
    }
  }
  regexCache.set(filter, out);
  return out;
}

/** Check one note against the filter list. Returns the matched filters,
 * or `false`. Pure. */
export function checkWordMute(
  note: MuteCheckNote,
  myId: string | null | undefined,
  mutedWords: Array<string | string[]> | null | undefined,
): WordMuteFilter[] | false {
  // Own notes are never muted, even on match.
  if (myId != null && note.userId === myId) return false;
  if (mutedWords == null || mutedWords.length === 0) return false;

  const text = `${note.cw ?? ""}\n${note.text ?? ""}`.trim();
  if (text === "") return false;

  const matched = mutedWords.filter((filter) => {
    if (Array.isArray(filter)) {
      const keywords = filter.filter((keyword) => keyword !== "");
      if (keywords.length === 0) return false;
      return keywords.every((keyword) => text.includes(keyword));
    }
    // Bare strings represent regular expressions.
    const regex = compiledRegex(filter);
    if (regex == null) return false;
    // A shared instance with `g`-like flags advances `lastIndex` on test,
    // which would flip later results — reset before every check.
    regex.lastIndex = 0;
    return regex.test(text);
  });

  return matched.length > 0 ? matched : false;
}

/** Check a note plus its reply and renote, first match wins. Pure. */
export function checkNoteWordMute(
  note: MuteCheckNote,
  myId: string | null | undefined,
  mutedWords: Array<string | string[]> | null | undefined,
): WordMuteFilter[] | false {
  if (mutedWords == null) return false;
  const direct = checkWordMute(note, myId, mutedWords);
  if (direct !== false) return direct;
  if (note.reply) {
    const replyResult = checkWordMute(note.reply, myId, mutedWords);
    if (replyResult !== false) return replyResult;
  }
  if (note.renote) {
    const renoteResult = checkWordMute(note.renote, myId, mutedWords);
    if (renoteResult !== false) return renoteResult;
  }
  return false;
}

/** Exact case-sensitive host match over author + reply author + renote
 * author. Pure. */
export function isInstanceMuted(
  note: MuteCheckNote,
  mutedInstances: string[] | Set<string> | null | undefined,
): boolean {
  if (mutedInstances == null) return false;
  const set = mutedInstances instanceof Set ? mutedInstances : new Set(mutedInstances);
  if (set.has(note.user.host ?? "")) return true;
  if (note.reply && set.has(note.reply.user.host ?? "")) return true;
  if (note.renote && set.has(note.renote.user.host ?? "")) return true;
  return false;
}

export class WordFilterParseError extends Error {
  line: number;
  code = "errors.filter.invalidRegex";
  constructor(line: number) {
    super(`Invalid regular expression on line ${line}.`);
    this.line = line;
  }
}

/** Serialize stored filters to the textarea form: keyword groups join
 * with single spaces, regex filters stay verbatim, one filter per line.
 * Pure. */
export function formatWordFilters(
  filters: Array<string | string[]> | null | undefined,
): string {
  return (filters ?? [])
    .map((filter) => (Array.isArray(filter) ? filter.join(" ") : filter))
    .join("\n");
}

/** Parse the textarea form back to stored filters. A line shaped like
 * `/pattern/flags` stays a bare regex string (never space-split) but must
 * compile — otherwise throws `WordFilterParseError` with the 1-based line
 * number and the caller must abort the save. Other lines split on single
 * spaces. Pure. */
export function parseWordFilters(raw: string): Array<string | string[]> {
  const lines = raw
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "") as Array<string | string[]>;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const regexp = line.match(/^\/(.+)\/(.*)$/);
    if (regexp) {
      try {
        new RegExp(regexp[1], regexp[2]);
        // Valid regex lines are kept whole — never split by spaces.
      } catch {
        throw new WordFilterParseError(i + 1);
      }
    } else {
      lines[i] = line.split(" ");
    }
  }
  return lines;
}

/** Parse a muted-instances textarea (one host per line/comma) into a clean
 * list. Hosts keep their case: matching is case-sensitive. Pure. */
export function parseMutedInstances(raw: string): string[] {
  return [...new Set(raw.split(/[\n,]+/).map((s) => s.trim()).filter((s) => s.length > 0))];
}
