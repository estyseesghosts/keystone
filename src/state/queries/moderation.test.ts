// F22/MK1: server-side moderation drops rows in every feed (v1
// `TimelineFeed.isExcluded` parity). Server soft words badge in v1 and
// have no badge UI here — they must NOT drop rows (see DECISIONS).
import {makeAccount, makePost} from '#/components/__tests__/fixtures'

import type {Filter} from '@keystone/fedi'

import {EMPTY_RULES, filterModerated, serverFilterWordsOf, type ModerationRules} from './moderation'
import {wordMuteListsOf} from './me'

function rules(over: Partial<ModerationRules> = {}): ModerationRules {
  return {
    ...EMPTY_RULES,
    mutedIds: new Set(over.mutedIds ?? []),
    blockedIds: new Set(over.blockedIds ?? []),
    renoteMutedIds: new Set(over.renoteMutedIds ?? []),
    ...over,
  }
}

describe('filterModerated (F22/MK1)', () => {
  it('returns posts unchanged when no rules are set', () => {
    const posts = [makePost({id: 'p1'}), makePost({id: 'p2'})]
    expect(filterModerated(posts, EMPTY_RULES)).toBe(posts)
  })

  it('drops posts by blocked or muted authors', () => {
    const bad = makePost({id: 'bad', author: makeAccount({id: 'u9'}), accountId: 'u9'})
    const good = makePost({id: 'good'})
    expect(filterModerated([bad, good], rules({blockedIds: new Set(['u9'])})).map(p => p.id)).toEqual(['good'])
    expect(filterModerated([bad, good], rules({mutedIds: new Set(['u9'])})).map(p => p.id)).toEqual(['good'])
  })

  it('drops rows whose reply or renote involves a blocked author', () => {
    const reply = makePost({id: 'r', author: makeAccount({id: 'u9'}), accountId: 'u9'})
    const via = makePost({id: 'via', reply, replyToId: 'r'})
    expect(filterModerated([via], rules({blockedIds: new Set(['u9'])})).map(p => p.id)).toEqual([])
  })

  it('drops pure reposts of renote-muted accounts (v1 parity)', () => {
    const original = makePost({
      id: 'orig',
      author: makeAccount({id: 'u9'}),
      accountId: 'u9',
      content: {mfm: 'original', plain: 'original'},
    })
    const wrapper = makePost({
      id: 'wrap',
      content: {plain: ''},
      renote: original,
      renoteId: 'orig',
    })
    expect(filterModerated([wrapper], rules({renoteMutedIds: new Set(['u9'])})).map(p => p.id)).toEqual([])
    expect(filterModerated([wrapper], EMPTY_RULES).map(p => p.id)).toEqual(['wrap'])
  })

  it('drops hard-word matches but never the viewer own posts', () => {
    const spam = makePost({id: 'spam', content: {mfm: 'buy now', plain: 'buy now'}})
    const hard = rules({hardMutedWords: [['buy']]})
    expect(filterModerated([spam], hard)).toEqual([])
    expect(filterModerated([spam], {...hard, selfId: spam.accountId})).toEqual([spam])
  })

  it('drops muted-instance hosts (exact, case-sensitive)', () => {
    const remote = makePost({id: 'rem', author: makeAccount({id: 'u2', host: 'bad.example'}), accountId: 'u2'})
    expect(
      filterModerated([remote], rules({mutedInstances: ['bad.example']})),
    ).toEqual([])
    expect(
      filterModerated([remote], rules({mutedInstances: ['BAD.example']})),
    ).toEqual([remote])
  })

  it('never drops rows on server soft words (badge UI is F16, not W4)', () => {
    const soft = makePost({id: 'soft', content: {mfm: 'spoiler talk', plain: 'spoiler talk'}})
    // `mutedWords` is not even a rule field the filter reads.
    expect(filterModerated([soft], rules({hardMutedWords: null}))).toEqual([soft])
  })
})

describe('serverFilterWordsOf (WS-F Mastodon-family word mutes)', () => {
  const row = (overrides: Partial<Filter> = {}): Filter => ({
    id: 'f1',
    phrase: 'buy',
    context: ['home'],
    expiresAt: null,
    irreversible: true,
    wholeWord: true,
    keywords: [{id: 'k1', keyword: 'buy', wholeWord: true}],
    ...overrides,
  })

  it('maps hide-action phrases to single-keyword literal groups', () => {
    expect(serverFilterWordsOf([row()])).toEqual([['buy']])
    expect(serverFilterWordsOf(null)).toBeNull()
    expect(serverFilterWordsOf([])).toEqual([])
  })

  it('enforces every keyword of a v2 group, not just the first', () => {
    expect(
      serverFilterWordsOf([
        row({
          keywords: [
            {id: 'k1', keyword: 'buy', wholeWord: true},
            {id: 'k2', keyword: 'spam', wholeWord: false},
          ],
        }),
      ]),
    ).toEqual([['buy'], ['spam']])
    const spam = makePost({id: 'spam', content: {plain: 'cheap spam here'}})
    const good = makePost({id: 'good'})
    const hard = rules({
      hardMutedWords: serverFilterWordsOf([
        row({
          keywords: [
            {id: 'k1', keyword: 'buy', wholeWord: true},
            {id: 'k2', keyword: 'spam', wholeWord: false},
          ],
        }),
      ]),
    })
    expect(filterModerated([spam, good], hard).map(p => p.id)).toEqual(['good'])
  })

  it('skips warn-action phrases (soft words badge; no badge UI here)', () => {
    expect(serverFilterWordsOf([row({irreversible: false})])).toEqual([])
  })

  it('trims phrases and drops blanks', () => {
    // Rows without a keyword list fall back to `phrase`.
    expect(
      serverFilterWordsOf([{...row(), keywords: []}, row({phrase: '   ', keywords: []})]),
    ).toEqual([['buy']])
    // Keyword text of a group is trimmed the same way.
    expect(
      serverFilterWordsOf([
        row({
          keywords: [
            {id: 'k1', keyword: '  buy  ', wholeWord: true},
            {id: 'k2', keyword: '   ', wholeWord: false},
          ],
        }),
      ]),
    ).toEqual([['buy']])
  })

  it('hide-action phrases drop matching posts through filterModerated', () => {
    const spam = makePost({id: 'spam', content: {mfm: 'buy now', plain: 'buy now'}})
    const good = makePost({id: 'good'})
    const hard = rules({hardMutedWords: serverFilterWordsOf([row()])})
    expect(filterModerated([spam, good], hard).map(p => p.id)).toEqual(['good'])
  })

  it('matches vanilla-Mastodon posts with no MFM source (plain fallback)', () => {
    const vanilla = makePost({id: 'vanilla', content: {plain: 'buy now'}})
    const hard = rules({hardMutedWords: serverFilterWordsOf([row()])})
    expect(filterModerated([vanilla], hard)).toEqual([])
  })
})

describe('wordMuteListsOf', () => {
  it('reads the Misskey-family bag off me.ext.me', () => {
    const me = makeAccount({
      ext: {me: {mutedWords: [['a', 'b'], '/x/i'], hardMutedWords: [['c']], mutedInstances: ['evil.example', 1]}},
    })
    expect(wordMuteListsOf(me)).toEqual({
      mutedWords: [['a', 'b'], '/x/i'],
      hardMutedWords: [['c']],
      mutedInstances: ['evil.example'],
    })
  })

  it('is all-null without a bag (mastodon family: matcher no-ops)', () => {
    expect(wordMuteListsOf(makeAccount())).toEqual({mutedWords: null, hardMutedWords: null, mutedInstances: null})
    expect(wordMuteListsOf(null)).toEqual({mutedWords: null, hardMutedWords: null, mutedInstances: null})
  })
})
