// F4: model URLs are gated — unsafe schemes never reach copy/share/open.
import {postLink} from '#/components/Post/menuModel'

import {makePost} from '../__tests__/fixtures'

describe('postLink (F4)', () => {
  it('prefers the server url when it is http(s)', () => {
    expect(postLink(makePost(), 'mastodon', 'https://example.social')).toBe(
      'https://example.social/notes/p1',
    )
  })

  it('drops a non-http server url and falls back honestly', () => {
    const evil = makePost({url: 'javascript:alert(1)', uri: 'https://example.social/notes/p1'})
    expect(postLink(evil, 'mastodon', 'https://example.social')).toBe('https://example.social/notes/p1')
  })

  it('returns null when no candidate survives (never a guessed scheme)', () => {
    const evil = makePost({url: 'javascript:alert(1)', uri: 'data:text/plain,x'})
    expect(postLink(evil, 'mastodon', 'https://example.social')).toBeNull()
    expect(postLink(evil, 'misskey', 'javascript:alert(1)')).toBeNull()
  })

  it('keeps the Misskey /notes/:id guess on a safe origin', () => {
    const plain = makePost({url: null, uri: null})
    expect(postLink(plain, 'misskey', 'https://misskey.example/')).toBe(
      'https://misskey.example/notes/p1',
    )
  })
})
