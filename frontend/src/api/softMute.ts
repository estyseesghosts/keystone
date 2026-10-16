// Soft-mute helpers (§13): muted-word / hard-muted-word / instance matching
// with forced-CW rendering. Upstream web does this client-side; Keystone
// follows the backend's server-CW decision so API clients agree — but until
// the server injects CW, the client applies the same rule locally: a
// muted-word match renders behind an injected CW (body kept), a hard match
// hides/drops the row. Pure matching lives here; rendering stays in
// NoteBody/TimelineFeed.

/** Normalize text for matching: case-insensitive, trimmed. Pure. */
function norm(text: string): string {
  return text.toLowerCase();
}

/** True when any keyword group matches: each inner array is an AND-group,
// groups are ORed (same semantics as antennas). A group matches when every
// non-empty keyword appears in the haystack. Pure. */
export function matchesWordGroups(groups: string[][] | null | undefined, haystack: string): boolean {
  if (!groups || groups.length === 0) return false;
  const hay = norm(haystack);
  if (hay.length === 0) return false;
  return groups.some(
    (group) =>
      Array.isArray(group) &&
      group.length > 0 &&
      group.every((kw) => typeof kw === "string" && kw.trim().length > 0 && hay.includes(norm(kw.trim()))),
  );
}

export type MuteVerdict = "show" | "soft" | "hard";

/** Decide a note row: hard muted words / muted instance → `hard`
 * (hidden/dropped); muted words → `soft` (forced CW, body kept);
 * otherwise `show`. Pure. */
export function muteVerdict(
  text: string | null,
  cw: string | null,
  userHost: string | null,
  opts: {
    mutedWords?: string[][] | null;
    hardMutedWords?: string[][] | null;
    mutedInstances?: string[] | null;
  },
): MuteVerdict {
  const haystack = `${text ?? ""}\n${cw ?? ""}`;
  if (
    userHost &&
    (opts.mutedInstances ?? []).some(
      (h) => typeof h === "string" && h.trim().length > 0 && userHost.toLowerCase() === h.trim().toLowerCase(),
    )
  ) {
    return "hard";
  }
  if (matchesWordGroups(opts.hardMutedWords, haystack)) return "hard";
  if (matchesWordGroups(opts.mutedWords, haystack)) return "soft";
  return "show";
}

/** Parse a muted-instances textarea (one host per line/comma) into a clean
 * list. Pure. */
export function parseMutedInstances(raw: string): string[] {
  return [...new Set(raw.split(/[\n,]+/).map((s) => s.trim()).filter((s) => s.length > 0))];
}

/** Parse word groups from lines: one line per AND-group, keywords separated
 * by spaces. Pure (editor transport format; the API takes string[][]). */
export function parseWordGroups(raw: string): string[][] {
  return raw
    .split("\n")
    .map((line) => line.split(/\s+/).map((s) => s.trim()).filter((s) => s.length > 0))
    .filter((group) => group.length > 0);
}

export function formatWordGroups(groups: string[][] | null | undefined): string {
  return (groups ?? []).map((g) => g.join(" ")).join("\n");
}
