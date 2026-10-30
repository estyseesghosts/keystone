// P6.5 Pages slice 1: toolbar edits. Every control × {selection,
// empty selection, toggle-off}; emitted text re-parsed with
// `contentFromMfm` yields the expected node kind (the §1 rule).

import {contentFromMfm} from '../src/core/content/fromMfm';
import {activeFormats, applyFormat, type FormatControl} from '../src/core/content/mfmFormat';

function kinds(source: string): string[] {
  const out: string[] = [];
  for (const n of contentFromMfm(source)) {
    out.push(n.kind);
    if (n.kind === 'fn') out.push(`fn:${(n as {name: string}).name}`);
  }
  return out;
}

describe('applyFormat', () => {
  const cases: Array<{control: FormatControl; arg?: string; text: string; wrapped: string; node: string; selected: string}> = [
    {control: 'bold', text: 'b', wrapped: '**b**', node: 'bold', selected: 'b'},
    {control: 'italic', text: 'x', wrapped: '<i>x</i>', node: 'italic', selected: 'x'},
    {control: 'strike', text: 't', wrapped: '~~t~~', node: 'strike', selected: 't'},
    {control: 'code', text: 'c', wrapped: '`c`', node: 'code', selected: 'c'},
    {control: 'codeblock', text: 'code', wrapped: '```\ncode\n```', node: 'codeBlock', selected: 'code'},
    {control: 'quote', text: 'hello', wrapped: '> hello', node: 'quote', selected: '> hello'},
    {control: 'link', arg: 'https://a.b', text: 't', wrapped: '[t](https://a.b)', node: 'link', selected: 't'},
    {control: 'center', text: 'c', wrapped: '<center>\nc\n</center>', node: 'fn:center', selected: 'c'},
    {control: 'small', text: 's', wrapped: '<small>s</small>', node: 'fn:small', selected: 's'},
  ];
  for (const {control, arg, text, wrapped, node, selected} of cases) {
    it(`${control}: selects content after wrapping`, () => {
      const at = {start: 0, end: text.length};
      const r = applyFormat(text, at, control, arg);
      expect(r.text).toBe(wrapped);
      // Selection covers the content, not the markers (link selects text).
      expect(r.text.slice(r.selection.start, r.selection.end)).toBe(selected);
      expect(kinds(r.text)).toContain(node);
    });
  }

  it('empty selection inserts markers with the caret between', () => {
    expect(applyFormat('', {start: 0, end: 0}, 'bold')).toEqual({text: '****', selection: {start: 2, end: 2}});
    expect(applyFormat('', {start: 0, end: 0}, 'code')).toEqual({text: '``', selection: {start: 1, end: 1}});
    expect(applyFormat('', {start: 0, end: 0}, 'link', 'https://a.b')).toEqual({
      text: '[https://a.b](https://a.b)',
      selection: {start: 1, end: 1 + 'https://a.b'.length},
    });
    const fence = applyFormat('x', {start: 1, end: 1}, 'codeblock');
    expect(fence.text).toBe('x```\n\n```');
    expect(fence.selection).toEqual({start: 5, end: 5});
  });

  it('toggles off when already wrapped (inside or adjacent)', () => {
    expect(applyFormat('**b**', {start: 0, end: 5}, 'bold').text).toBe('b');
    expect(applyFormat('**b**', {start: 2, end: 3}, 'bold').text).toBe('b');
    expect(applyFormat('<i>x</i>', {start: 0, end: 8}, 'italic').text).toBe('x');
    expect(applyFormat('~~t~~', {start: 2, end: 3}, 'strike').text).toBe('t');
    expect(applyFormat('`c`', {start: 0, end: 3}, 'code').text).toBe('c');
    expect(applyFormat('```\ncode\n```', {start: 0, end: 12}, 'codeblock').text).toBe('code');
    expect(applyFormat('> hello', {start: 0, end: 7}, 'quote').text).toBe('hello');
  });

  it('refuses selections it cannot render', () => {
    expect(applyFormat('a\nb', {start: 0, end: 3}, 'code')).toEqual({text: 'a\nb', selection: {start: 0, end: 3}});
    expect(applyFormat('a\nb', {start: 0, end: 3}, 'strike').text).toBe('a\nb');
    expect(applyFormat('a\nb', {start: 0, end: 3}, 'link', 'https://a.b').text).toBe('a\nb');
    expect(applyFormat('t', {start: 0, end: 1}, 'link', '').text).toBe('t');
  });

  it('quotes per selected line and untoggles only when all lines quoted', () => {
    const r = applyFormat('a\nb', {start: 0, end: 3}, 'quote');
    expect(r.text).toBe('> a\n> b');
    expect(applyFormat('> a\nb', {start: 0, end: 5}, 'quote').text).toBe('> a\n> b');
    expect(applyFormat('> a\n> b', {start: 0, end: 7}, 'quote').text).toBe('a\nb');
  });

  it('activeFormats reports the would-toggle-off set', () => {
    expect(activeFormats('**b**', {start: 0, end: 5})).toEqual(['bold']);
    expect(activeFormats('plain', {start: 0, end: 5})).toEqual([]);
    expect(activeFormats('> a\n> b', {start: 0, end: 7})).toContain('quote');
    expect(activeFormats('*x*', {start: 0, end: 3})).toEqual(['italic']);
  });
});
