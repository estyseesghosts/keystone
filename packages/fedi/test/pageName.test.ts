// P6.5 Pages slice 1: slug rules are verbatim upstream
// (misskey `models/Page.ts:122`).

import {copyName, defaultPageName, isValidPageName, PAGE_NAME_PATTERN_SOURCE} from '../src/core/pageName';

describe('isValidPageName (upstream parity)', () => {
  it('accepts ordinary slugs', () => {
    for (const ok of ['hello', 'Hello-World_2', '123', '日本語', 'x'.repeat(256), String(Date.now())]) {
      expect(isValidPageName(ok)).toBe(true);
    }
  });
  it('rejects the plan table', () => {
    for (const bad of [
      '',
      'has space',
      'a/b',
      'a#b',
      'a%b',
      'a?b',
      'a:b',
      'a@b',
      'a[b]',
      'a!b',
      'a$b',
      "a'b",
      'a(b)',
      'a*b',
      'a+b',
      'a,b',
      'a;b',
      'a=b',
      'a\\b',
      'x'.repeat(257),
      'tab\there',
      'nl\nhere',
      'nul\0here',
    ]) {
      expect(isValidPageName(bad)).toBe(false);
    }
  });
  it('keeps the pattern source citable', () => {
    const fromSource = new RegExp(PAGE_NAME_PATTERN_SOURCE);
    expect(fromSource.test('hello')).toBe(true);
    expect(fromSource.test('a/b')).toBe(false);
  });
});

describe('page name helpers', () => {
  it('defaults to the timestamp slug', () => {
    expect(defaultPageName(123)).toBe('123');
    expect(isValidPageName(defaultPageName())).toBe(true);
  });
  it('numbers duplicate copies', () => {
    expect(copyName('guide', 1)).toBe('guide-copy');
    expect(copyName('guide', 2)).toBe('guide-copy-2');
  });
});
