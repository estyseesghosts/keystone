// F4: model URLs are gated — unsafe schemes never reach copy/share/open.
import {buildPostMenu, postLink} from '#/components/Post/menuModel'

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

describe('remote-link resolution (MK17)', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  function inputFor(uri: string | null) {
    const post = makePost({url: 'https://example.social/notes/local-1', uri})
    const open = jest.fn()
    const input = {
      family: 'mastodon',
      capabilities: null,
      post,
      origin: 'https://example.social',
      isOwn: false,
      copyAvailable: true,
      bookmark: {gate: {enabled: false, reason: 'x'}, value: false, set: jest.fn()},
      del: {gate: {enabled: false, reason: 'x'}, run: jest.fn()},
      handlers: {
        copy: jest.fn(),
        share: jest.fn(),
        open,
        translate: jest.fn(),
        muteThread: jest.fn(),
        togglePin: jest.fn(),
      },
    } as never
    return {input, open}
  }

  function remoteRow(input: never) {
    const sections = buildPostMenu(input)
    return sections[0].find(i => i.key === 'view-remote')
  }

  it('falls back to the raw id when the page is not cached', () => {
    const uri = 'https://remote.example/ap/notes/cold-1'
    const {input, open} = inputFor(uri)
    const row = remoteRow(input)
    expect(row).toBeDefined()
    void row!.run!()
    expect(open).toHaveBeenCalledWith(uri)
  })

  it('prefers the warmed page URL once resolved', async () => {
    const {resolveRemotePostUrl} = (await import('@keystone/fedi')) as typeof import('@keystone/fedi')
    const uri = 'https://remote.example/ap/notes/warm-1'
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({id: uri, url: 'https://remote.example/@u/1'}),
    })) as never
    await expect(resolveRemotePostUrl(uri)).resolves.toBe('https://remote.example/@u/1')
    const {input, open} = inputFor(uri)
    const row = remoteRow(input)
    expect(row).toBeDefined()
    void row!.run!()
    expect(open).toHaveBeenCalledWith('https://remote.example/@u/1')
  })

  it('ignores objects describing a different id (never a guessed page)', async () => {
    const {resolveRemotePostUrl} = (await import('@keystone/fedi')) as typeof import('@keystone/fedi')
    const uri = 'https://remote.example/ap/notes/spoof-1'
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({id: 'https://evil.example/other', url: 'https://evil.example/other'}),
    })) as never
    await expect(resolveRemotePostUrl(uri)).resolves.toBeNull()
  })
})
