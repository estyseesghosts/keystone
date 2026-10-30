// MFM formatting edits for the page editor toolbar (P6.5 Pages,
// slice 1). Pure string surgery — no mfm-js import (the UI-thread
// live-markdown worklet in slice 6 cannot import it either; both sides
// share these exact emitted shapes).
//
// Every control emits only syntax `fromMfm` maps to a rendered node
// (verified against mfm-js 0.27 + RichText `fn` cases): `**bold**`,
// `<i>…</i>` (never `*…*` — `italicAsta` matches ASCII only, so
// `*日本語*` stays literal), `~~strike~~`, `` `code` ``,
// fenced blocks, `> ` quotes, `[text](url)` (http/https, vetted by the
// caller), `<center>` / `<small>` on their own lines.
//
// Toggle-off: applying a control whose markers already wrap the
// selection (inside the selection or immediately outside it) removes
// them instead. Refusals (returned unchanged): inline `code` and links
// spanning a newline (mfm cannot render them); `~~strike~~` spanning a
// newline; `link` without a vetted URL.

export type FormatControl =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'codeblock'
  | 'quote'
  | 'link'
  | 'center'
  | 'small';

export interface TextSelection {
  start: number
  end: number
}

export interface FormatResult {
  text: string
  selection: TextSelection
}

function clampSelection(text: string, sel: TextSelection): TextSelection {
  const start = Math.max(0, Math.min(text.length, Math.min(sel.start, sel.end)));
  const end = Math.max(0, Math.min(text.length, Math.max(sel.start, sel.end)));
  return {start, end};
}

function splice(text: string, start: number, end: number, insert: string): string {
  return text.slice(0, start) + insert + text.slice(end);
}

/** Unwrap when `text[start..end]` is wrapped in `open`/`close` (markers
 * inside the selection), else when they sit immediately outside it.
 * Returns the unwrapped span or null. */
function wrappedIn(text: string, start: number, end: number, open: string, close: string): {start: number; end: number} | null {
  const sel = text.slice(start, end);
  if (sel.startsWith(open) && sel.endsWith(close) && sel.length >= open.length + close.length) {
    return {start: start + open.length, end: end - close.length};
  }
  if (text.startsWith(open, start - open.length) && text.startsWith(close, end)) {
    return {start, end};
  }
  return null;
}

function wrapToggle(
  text: string,
  sel: TextSelection,
  open: string,
  close: string,
  refuseNewline: boolean,
): FormatResult {
  const selected = text.slice(sel.start, sel.end);
  if (refuseNewline && selected.includes('\n')) return {text, selection: sel};
  const unwrapped = wrappedIn(text, sel.start, sel.end, open, close);
  if (unwrapped) {
    const inner = text.slice(unwrapped.start, unwrapped.end);
    return {
      text: splice(text, unwrapped.start - open.length, unwrapped.end + close.length, inner),
      selection: {start: unwrapped.start - open.length, end: unwrapped.start - open.length + inner.length},
    };
  }
  if (sel.start === sel.end) {
    return {
      text: splice(text, sel.start, sel.end, open + close),
      selection: {start: sel.start + open.length, end: sel.start + open.length},
    };
  }
  return {
    text: splice(text, sel.start, sel.end, open + selected + close),
    selection: {start: sel.start + open.length, end: sel.start + open.length + selected.length},
  };
}

function lineBounds(text: string, offset: number): {start: number; end: number} {
  let start = offset;
  while (start > 0 && text[start - 1] !== '\n') start--;
  let end = offset;
  while (end < text.length && text[end] !== '\n') end++;
  return {start, end};
}

function applyQuote(text: string, sel: TextSelection): FormatResult {
  // Expand to whole lines intersecting the selection (empty selection =
  // the current line), then toggle the `> ` prefix per line.
  const from = sel.start === sel.end ? sel.start : sel.start;
  const to = sel.start === sel.end ? sel.start : sel.end;
  const first = lineBounds(text, from).start;
  const last = lineBounds(text, Math.max(to - 1, 0)).end;
  const chunk = text.slice(first, last);
  const lines = chunk.split('\n');
  const isQuoted = (l: string): boolean => /^ {0,3}> ?/.test(l);
  const allQuoted = lines.every(isQuoted);
  const toggled = lines.map(l => (allQuoted ? l.replace(/^ {0,3}> ?/, '') : isQuoted(l) ? l : `> ${l}`));
  const out = toggled.join('\n');
  // Selection tracks the line block; caret-only grows to the new line.
  if (sel.start === sel.end) {
    const at = sel.start - first;
    const next = allQuoted ? at - Math.min(2, at) : at + 2;
    return {text: splice(text, first, last, out), selection: {start: first + Math.max(0, next), end: first + Math.max(0, next)}};
  }
  return {text: splice(text, first, last, out), selection: {start: first, end: first + out.length}};
}

function applyCodeblock(text: string, sel: TextSelection): FormatResult {
  const selected = text.slice(sel.start, sel.end);
  if (sel.start === sel.end) {
    const insert = '```\n\n```';
    return {
      text: splice(text, sel.start, sel.end, insert),
      selection: {start: sel.start + 4, end: sel.start + 4},
    };
  }
  const inner = wrappedIn(text, sel.start, sel.end, '```\n', '\n```');
  if (inner) {
    const body = text.slice(inner.start, inner.end);
    const from = inner.start - '```\n'.length;
    return {text: splice(text, from, inner.end + '\n```'.length, body), selection: {start: from, end: from + body.length}};
  }
  const insert = `\`\`\`\n${selected}\n\`\`\``;
  return {
    text: splice(text, sel.start, sel.end, insert),
    selection: {start: sel.start + 4, end: sel.start + 4 + selected.length},
  };
}

function applyLink(text: string, sel: TextSelection, url: string | undefined): FormatResult {
  if (!url) return {text, selection: sel};
  const selected = sel.start === sel.end ? url : text.slice(sel.start, sel.end);
  if (selected.includes('\n')) return {text, selection: sel};
  const insert = `[${selected}](${url})`;
  return {
    text: splice(text, sel.start, sel.end, insert),
    selection: {start: sel.start + 1, end: sel.start + 1 + selected.length},
  };
}

function applyCenter(text: string, sel: TextSelection): FormatResult {
  const selected = text.slice(sel.start, sel.end);
  const open = '<center>\n';
  const close = '\n</center>';
  const inner = wrappedIn(text, sel.start, sel.end, '<center>', '</center>');
  if (inner) {
    const body = text.slice(inner.start, inner.end).replace(/^\n|\n$/g, '');
    const from = inner.start - '<center>'.length;
    return {text: splice(text, from, inner.end + '</center>'.length, body), selection: {start: from, end: from + body.length}};
  }
  if (sel.start === sel.end) {
    const insert = '<center>\n\n</center>';
    return {text: splice(text, sel.start, sel.end, insert), selection: {start: sel.start + open.length, end: sel.start + open.length}};
  }
  const insert = `${open}${selected}${close}`;
  return {
    text: splice(text, sel.start, sel.end, insert),
    selection: {start: sel.start + open.length, end: sel.start + open.length + selected.length},
  };
}

/**
 * Apply one toolbar control (plan §1). `url` is the vetted http(s) link
 * target (link only; the UI prompts — empty means no-op). Never throws;
 * refusals return the input unchanged.
 */
export function applyFormat(
  text: string,
  selection: TextSelection,
  control: FormatControl,
  url?: string,
): FormatResult {
  const sel = clampSelection(text, selection);
  switch (control) {
    case 'bold':
      return wrapToggle(text, sel, '**', '**', false);
    case 'italic':
      return wrapToggle(text, sel, '<i>', '</i>', false);
    case 'strike':
      return wrapToggle(text, sel, '~~', '~~', true);
    case 'code':
      return wrapToggle(text, sel, '`', '`', true);
    case 'codeblock':
      return applyCodeblock(text, sel);
    case 'quote':
      return applyQuote(text, sel);
    case 'link':
      return applyLink(text, sel, url);
    case 'center':
      return applyCenter(text, sel);
    case 'small':
      return wrapToggle(text, sel, '<small>', '</small>', true);
  }
}

/**
 * Controls that would toggle OFF for this selection (active toolbar
 * state). Quote counts when every intersecting line is already quoted;
 * codeblock when the selection exactly covers a fenced block.
 */
export function activeFormats(text: string, selection: TextSelection): FormatControl[] {
  const sel = clampSelection(text, selection);
  const out: FormatControl[] = [];
  const is = (open: string, close: string): boolean => wrappedIn(text, sel.start, sel.end, open, close) !== null;
  if (is('**', '**')) out.push('bold');
  if (is('<i>', '</i>')) out.push('italic');
  else if (sel.start < sel.end && /^\*[A-Za-z0-9 ]+\*$/.test(text.slice(sel.start, sel.end))) out.push('italic');
  if (is('~~', '~~')) out.push('strike');
  if (is('`', '`')) out.push('code');
  if (is('<small>', '</small>')) out.push('small');
  if (is('<center>', '</center>')) out.push('center');
  if (is('```\n', '\n```')) out.push('codeblock');
  if (sel.start !== sel.end || text.length > 0) {
    const from = sel.start === sel.end ? sel.start : sel.start;
    const to = sel.start === sel.end ? sel.start : sel.end;
    const first = lineBounds(text, from).start;
    const last = lineBounds(text, Math.max(to - 1, 0)).end;
    const lines = text.slice(first, last).split('\n');
    if (lines.length > 0 && lines.every(l => /^ {0,3}> ?/.test(l))) out.push('quote');
  }
  return out;
}
