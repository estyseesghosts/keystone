// F4: model URLs are gated — unsafe schemes never reach copy/share/open.
import {buildPostMenu, buildUserSubmenu, flatten, postLink} from '#/components/Post/menuModel'

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

describe('user submenu relation labels (C16)', () => {
  function userRows(user: Record<string, unknown>) {
    const post = makePost()
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
        open: jest.fn(),
        translate: jest.fn(),
        muteThread: jest.fn(),
        togglePin: jest.fn(),
        user,
      },
    } as never
    return flatten(buildUserSubmenu(input))
  }

  const all = () => ({onMute: jest.fn(), onMuteBoosts: jest.fn(), onBlock: jest.fn()})

  it('uses enable-direction labels when the relation is unknown', () => {
    const rows = userRows(all())
    expect(rows.find(i => i.key === 'mute')?.label).toBe('Mute')
    expect(rows.find(i => i.key === 'mute-boosts')?.label).toBe('Mute boosts')
    expect(rows.find(i => i.key === 'block')?.label).toBe('Block')
  })

  it('flips to disable-direction labels from the relation snapshot', () => {
    const rows = userRows({...all(), muted: true, renoteMuted: true, blocking: true})
    expect(rows.find(i => i.key === 'mute')?.label).toBe('Unmute')
    expect(rows.find(i => i.key === 'mute-boosts')?.label).toBe('Unmute boosts')
    expect(rows.find(i => i.key === 'block')?.label).toBe('Unblock')
    // Unblock drops the block confirm (confirm only guards blocking).
    expect(rows.find(i => i.key === 'block')?.confirm).toBeUndefined()
  })

  it('disables rows with no handler and an honest reason', () => {
    const rows = userRows({})
    const boosts = rows.find(i => i.key === 'mute-boosts')
    expect(boosts?.disabled).toBe(true)
    expect(boosts?.reason).toMatch(/not connected/)
  })
})

describe('clip row (W5)', () => {
  function clipRow(caps: unknown, onClip?: () => void) {
    const post = makePost()
    const input = {
      family: 'misskey',
      capabilities: caps,
      post,
      origin: 'https://misskey.example',
      isOwn: false,
      copyAvailable: true,
      bookmark: {gate: {enabled: false, reason: 'x'}, value: false, set: jest.fn()},
      del: {gate: {enabled: false, reason: 'x'}, run: jest.fn()},
      handlers: {
        copy: jest.fn(),
        share: jest.fn(),
        open: jest.fn(),
        translate: jest.fn(),
        muteThread: jest.fn(),
        togglePin: jest.fn(),
        ...(onClip ? {onClip} : {}),
      },
    } as never
    return flatten(buildPostMenu(input)).find(i => i.key === 'clip')!
  }

  it('opens the add-to-clip flow when supported and connected', () => {
    const onClip = jest.fn()
    const row = clipRow({clips: 'supported'}, onClip)
    expect(row.disabled).toBeUndefined()
    row.run!()
    expect(onClip).toHaveBeenCalled()
  })

  it('stays honestly disabled without clips support', () => {
    const row = clipRow({clips: 'unsupported'}, jest.fn())
    expect(row.disabled).toBe(true)
    expect(row.reason).toMatch(/no clips/i)
  })

  it('stays honestly disabled with no picker connected', () => {
    const row = clipRow({clips: 'supported'})
    expect(row.disabled).toBe(true)
    expect(row.reason).toMatch(/connected to this view/)
  })
})

describe('DM row (0.9 — messaging gated, not invisible)', () => {
  function dmInput(opts: {caps?: unknown; onMessage?: () => void; family?: 'mastodon' | 'misskey'} = {}) {
    const post = makePost()
    return {
      family: opts.family ?? 'mastodon',
      capabilities: opts.caps === undefined ? {} : opts.caps,
      post,
      origin: 'https://example.social',
      isOwn: false,
      copyAvailable: true,
      bookmark: {gate: {enabled: false, reason: 'x'}, value: false, set: jest.fn()},
      del: {gate: {enabled: false, reason: 'x'}, run: jest.fn()},
      handlers: {
        copy: jest.fn(),
        share: jest.fn(),
        open: jest.fn(),
        translate: jest.fn(),
        muteThread: jest.fn(),
        togglePin: jest.fn(),
        ...(opts.onMessage ? {user: {onMessage: opts.onMessage}} : {}),
      },
    } as never
  }

  function dmRow(opts: {caps?: unknown; onMessage?: () => void; family?: 'mastodon' | 'misskey'} = {}) {
    return flatten(buildUserSubmenu(dmInput(opts))).find(i => i.key === 'dm')
  }

  it('is reachable from the post menu User submenu, not omitted', () => {
    const user = flatten(buildPostMenu(dmInput({caps: {direct_messages: 'unsupported'}}))).find(
      i => i.key === 'user',
    )
    expect(flatten(user!.submenu!).map(i => i.key)).toContain('dm')
  })

  it('is present and disabled with the client-gap reason, never omitted (mastodon)', () => {
    const row = dmRow({caps: {direct_messages: 'unsupported'}})
    expect(row).toBeDefined()
    expect(row!.disabled).toBe(true)
    // Specific reason: the missing surface is Keystone's, not the server's.
    expect(row!.reason).toMatch(/not implemented in Keystone yet/i)
    expect(row!.reason).not.toMatch(/this server (does not|doesn't|cannot|has no)/i)
    // Not the old generic placeholder this slice replaces.
    expect(row!.reason).not.toMatch(/not available in this build yet/i)
  })

  it('carries the same honest reason on the Misskey family', () => {
    const row = dmRow({caps: {direct_messages: 'unsupported'}, family: 'misskey'})
    expect(row!.disabled).toBe(true)
    expect(row!.reason).toMatch(/not implemented in Keystone yet/i)
  })

  it('keeps the reason when capabilities were never loaded (signed out/stale)', () => {
    const row = dmRow()
    expect(row).toBeDefined()
    expect(row!.disabled).toBe(true)
    expect(row!.reason).toMatch(/not implemented in Keystone yet/i)
  })

  it('opens the composer only when the capability is supported and wired', () => {
    const onMessage = jest.fn()
    const row = dmRow({caps: {direct_messages: 'supported'}, onMessage})
    expect(row!.disabled).toBeUndefined()
    row!.run!()
    expect(onMessage).toHaveBeenCalled()
  })

  it('stays disabled on a supported server with no composer connected', () => {
    const row = dmRow({caps: {direct_messages: 'supported'}})
    expect(row!.disabled).toBe(true)
    expect(row!.reason).toMatch(/no message composer is connected/i)
  })
})

describe('report row (WS-D)', () => {
  function reportInput(opts: {isOwn?: boolean; caps?: unknown; user?: unknown} = {}) {
    const post = makePost()
    return {
      family: 'mastodon',
      capabilities: opts.caps === undefined ? {} : opts.caps,
      post,
      origin: 'https://example.social',
      isOwn: opts.isOwn ?? false,
      copyAvailable: true,
      bookmark: {gate: {enabled: false, reason: 'x'}, value: false, set: jest.fn()},
      del: {gate: {enabled: false, reason: 'x'}, run: jest.fn()},
      handlers: {
        copy: jest.fn(),
        share: jest.fn(),
        open: jest.fn(),
        translate: jest.fn(),
        muteThread: jest.fn(),
        togglePin: jest.fn(),
        ...(opts.user ? {user: opts.user} : {}),
      },
    } as never
  }

  it('is hidden for own posts', () => {
    const onReport = jest.fn()
    expect(flatten(buildPostMenu(reportInput({isOwn: true, user: {onReport}}))).find(i => i.key === 'report')).toBeUndefined()
  })

  it('is disabled with a sign-in reason when signed out', () => {
    const row = flatten(buildPostMenu(reportInput({caps: null, user: {onReport: jest.fn()}}))).find(i => i.key === 'report')!
    expect(row.disabled).toBe(true)
    expect(row.reason).toMatch(/Sign in/)
  })

  it('is disabled with a reason when no reporter is connected', () => {
    const row = flatten(buildPostMenu(reportInput({}))).find(i => i.key === 'report')!
    expect(row.disabled).toBe(true)
    expect(row.reason).toMatch(/connected/)
  })

  it('opens the chooser with its family and passes the chosen values', () => {
    const onReport = jest.fn()
    const row = flatten(buildPostMenu(reportInput({user: {onReport}}))).find(i => i.key === 'report')!
    expect(row.disabled).toBeUndefined()
    expect(row.report?.action).toBe('Send report')
    expect(row.report?.family).toBe('mastodon')
    // makePost()'s author is remote, so forwarding is offered.
    expect(row.report?.remoteHost).toBe('example.social')
    void row.report!.run({comment: 'spam', category: 'spam', ruleIds: [], forward: true})
    expect(onReport).toHaveBeenCalledWith({
      comment: 'spam',
      category: 'spam',
      ruleIds: [],
      forward: true,
    })
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

describe('translate row (E6)', () => {
  function translateRow(translation: unknown) {
    const post = makePost()
    const input = {
      family: 'misskey',
      capabilities: {translation},
      post,
      origin: 'https://misskey.example',
      isOwn: false,
      copyAvailable: true,
      bookmark: {gate: {enabled: false, reason: 'x'}, value: false, set: jest.fn()},
      del: {gate: {enabled: false, reason: 'x'}, run: jest.fn()},
      handlers: {
        copy: jest.fn(),
        share: jest.fn(),
        open: jest.fn(),
        translate: jest.fn(),
        muteThread: jest.fn(),
        togglePin: jest.fn(),
      },
    } as never
    return flatten(buildPostMenu(input)).find(i => i.key === 'translate')!
  }

  it('enables the row when the server advertises translation', () => {
    const row = translateRow('supported')
    expect(row.disabled).toBeUndefined()
  })

  it('blames the server only when the server was actually asked', () => {
    const row = translateRow('unsupported')
    expect(row.disabled).toBe(true)
    expect(row.reason).toMatch(/no translation service/i)
  })

  it('tells stale sessions to sign in again instead of blaming the server', () => {
    const row = translateRow('unknown')
    expect(row.disabled).toBe(true)
    expect(row.reason).toMatch(/sign in again/i)
  })
})

describe('delete-and-redraft row (clickstone §1.7)', () => {
  function redraftRow(opts: {delEnabled?: boolean; onRedraft?: unknown} = {}) {
    const input = {
      family: 'mastodon',
      capabilities: {},
      post: makePost(),
      origin: 'https://example.social',
      isOwn: true,
      copyAvailable: true,
      bookmark: {gate: {enabled: false, reason: 'x'}, value: false, set: jest.fn()},
      del: {
        gate: opts.delEnabled === false ? {enabled: false, reason: 'gate.notYours'} : {enabled: true},
        run: jest.fn(),
      },
      handlers: {
        copy: jest.fn(),
        share: jest.fn(),
        open: jest.fn(),
        translate: jest.fn(),
        muteThread: jest.fn(),
        togglePin: jest.fn(),
        ...(opts.onRedraft ? {onRedraft: opts.onRedraft} : {}),
      },
    } as never
    return flatten(buildPostMenu(input)).find(i => i.key === 'redraft')
  }

  it('asks first and carries the data-loss warning', () => {
    const onRedraft = jest.fn()
    const row = redraftRow({onRedraft})!
    expect(row.label).toBe('Delete and redraft')
    expect(row.destructive).toBe(true)
    expect(row.confirm?.title).toBe('Delete and redraft this post?')
    expect(row.confirm?.message).toMatch(/cannot be restored/)
    expect(onRedraft).not.toHaveBeenCalled()
  })

  it('is disabled with a reason when no composer is connected', () => {
    const row = redraftRow()!
    expect(row.disabled).toBe(true)
    expect(row.reason).toMatch(/No composer/)
  })

  it('follows the delete gate (own posts only)', () => {
    const row = redraftRow({delEnabled: false, onRedraft: jest.fn()})!
    expect(row.disabled).toBe(true)
  })

  it('is absent for other people\'s posts', () => {
    const input = {
      family: 'misskey',
      capabilities: {},
      post: makePost(),
      origin: 'https://example.social',
      isOwn: false,
      copyAvailable: true,
      bookmark: {gate: {enabled: false, reason: 'x'}, value: false, set: jest.fn()},
      del: {gate: {enabled: false, reason: 'x'}, run: jest.fn()},
      handlers: {
        copy: jest.fn(),
        share: jest.fn(),
        open: jest.fn(),
        translate: jest.fn(),
        muteThread: jest.fn(),
        togglePin: jest.fn(),
        onRedraft: jest.fn(),
      },
    } as never
    expect(flatten(buildPostMenu(input)).find(i => i.key === 'redraft')).toBeUndefined()
  })
})
