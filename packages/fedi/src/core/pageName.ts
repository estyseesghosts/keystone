// Misskey page slug rules (P6.5 Pages, slice 1).
//
// `PAGE_NAME_PATTERN` is verbatim upstream
// (`misskey/packages/backend/src/models/Page.ts:122` — `pageNameSchema`);
// `defaultPageName` mirrors the editor default (`Date.now().toString()` —
// numeric slugs cannot collide). Pure.

/** Verbatim upstream `pageNameSchema` pattern (no whitespace, controls,
 * `: / ? # [ ] @ ! $ & ' ( ) * + , ; = % \` or backslash, 1–256 chars). */
export const PAGE_NAME_PATTERN: RegExp =
  /^[^\s:\/?#\[\]@!$&'()*+,;=\\%\x00-\x20]{1,256}$/;

/** The pattern source (fixture/test parity checks). */
export const PAGE_NAME_PATTERN_SOURCE: string = PAGE_NAME_PATTERN.source;

/** True for a slug the server will accept (plan §2). Pure. */
export function isValidPageName(name: string): boolean {
  return PAGE_NAME_PATTERN.test(name);
}

/** Editor default slug (plan §3.4.3): the timestamp, always valid. Pure. */
export function defaultPageName(now: number = Date.now()): string {
  return String(now);
}

/** Suffix for a duplicated page (`-copy`, `-copy-2`, …; plan §4 step 3). Pure. */
export function copyName(name: string, n: number): string {
  return n <= 1 ? `${name}-copy` : `${name}-copy-${n}`;
}
