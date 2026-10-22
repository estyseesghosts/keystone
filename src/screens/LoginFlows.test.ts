import {
  callbackUri,
  createMemoryStore,
  DEFAULT_CALLBACK_PATH,
  MfaRequiredError,
  type KeyValueStore,
} from '@keystone/fedi'

import {AUTH_CALLBACK_PATHS, AUTH_CALLBACK_PATH, LEGACY_AUTH_CALLBACK_PATH} from '#/routes'

import {
  completeMastodonOAuth as complete,
  mastodonMfaSignin,
  mastodonPasswordSignin as uiMastodonPassword,
  misskeyPasswordSignin as uiMisskeyPassword,
  normalizeServerInput as uiNormalize,
  pollMisskeyApproval,
  startMastodonOAuth as start,
  startMisskeyMiAuth,
  takeMisskeyPending,
  webCallbackUri,
} from './LoginFlows'

const ORIGIN_A = 'https://a.example'
const ORIGIN_B = 'https://b.example'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  })
}

const ME_A = {id: 'alice-id', username: 'alice'}
const ME_B = {id: 'bob-id', username: 'bob'}

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('registered OAuth callback (clickstone §1.13)', () => {
  it('registers the canonical /auth/callback at every base', () => {
    // The exact redirect_uri handed to `registerApp` on web. Unchanged from
    // the original v2 registration, so no instance re-registers.
    expect(webCallbackUri('https://app.example')).toBe('https://app.example/auth/callback')
    expect(webCallbackUri('https://app.example')).toBe(
      callbackUri('https://app.example', AUTH_CALLBACK_PATH),
    )
    // A root-relative deploy has no origin yet; the path is still canonical.
    expect(webCallbackUri(null)).toBe(AUTH_CALLBACK_PATH)
  })

  it('accepts the packages/fedi default path too (v1 root alias kept)', () => {
    // Whatever the package-level default is, the route table serves it:
    // that is what keeps pre-rebuild registrations landing.
    expect(AUTH_CALLBACK_PATHS).toContain(DEFAULT_CALLBACK_PATH)
    expect(AUTH_CALLBACK_PATHS).toContain(LEGACY_AUTH_CALLBACK_PATH)
  })
})

describe('normalizeServerInput', () => {
  it('normalizes bare hosts, trims, and rejects junk', () => {
    expect(uiNormalize('a.example')).toBe('https://a.example')
    expect(uiNormalize('  https://a.example/ ')).toBe('https://a.example')
    expect(uiNormalize('http://a.example')).toBe('http://a.example')
    expect(uiNormalize('')).toBeNull()
    expect(uiNormalize('not a url at all !!!')).toBeNull()
    expect(uiNormalize('ftp://a.example')).toBeNull()
    expect(uiNormalize('https://user:pass@a.example')).toBeNull()
  })
})

/** Route a canned script by method+path; records every call for isolation asserts. */
function scriptFetch(
  calls: Array<{url: string; body: string}>,
  script: Array<{match: (url: string, method: string) => boolean; respond: () => Response}>,
) {
  return jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({url, body: typeof init?.body === 'string' ? init.body : ''})
    const step = script.find(s => s.match(url, method))
    if (!step) throw new Error(`unexpected request ${method} ${url}`)
    return step.respond()
  }) as unknown as typeof fetch
}

function misskeyScript(
  origin: string,
  opts: {native: string; appToken: string; me: {id: string; username: string}},
) {
  const path = (p: string) => (url: string) => url === `${origin}${p}`
  return [
    {match: (url: string) => path('/api/signin-flow')(url), respond: () => jsonResponse({finished: true, id: 'flow-1', i: opts.native})},
    {match: (url: string) => path('/api/miauth/gen-token')(url), respond: () => jsonResponse({token: 'gen-1'})},
    {
      match: (url: string) => url.startsWith(`${origin}/api/miauth/`) && url.endsWith('/check'),
      respond: () => jsonResponse({ok: true, token: opts.appToken}),
    },
    {match: (url: string) => path('/api/i')(url), respond: () => jsonResponse(opts.me)},
  ]
}

describe('misskeyPasswordSignin', () => {
  it('mints + verifies before returning, composing the fedi surface', async () => {
    const calls: Array<{url: string; body: string}> = []
    globalThis.fetch = scriptFetch(calls, misskeyScript(ORIGIN_A, {native: 'native-a', appToken: 'app-a', me: ME_A}))
    const res = await uiMisskeyPassword({origin: ORIGIN_A, flavor: 'misskey', username: 'alice', password: 'pw'})
    expect(res.token).toBe('app-a')
    expect(res.account.id).toBe('alice-id')
    expect(res.grant).toBe('miauth')
    // Verify-before-store: the `i` check ran with the app token.
    const verifyCall = calls.find(c => c.url === `${ORIGIN_A}/api/i`)
    expect(verifyCall).toBeTruthy()
    expect(JSON.parse(verifyCall!.body)).toEqual({i: 'app-a'})
    // The native credential went only to gen-token, never to `i`.
    expect(JSON.parse(verifyCall!.body)).not.toHaveProperty('native-a')
  })

  it('falls back to native signin when signin-flow is absent (Pinetree shape)', async () => {
    const calls: Array<{url: string; body: string}> = []
    globalThis.fetch = scriptFetch(calls, [
      {match: url => url === `${ORIGIN_A}/api/signin-flow`, respond: () => jsonResponse({error: 'not found'}, 404)},
      {match: url => url === `${ORIGIN_A}/api/signin`, respond: () => jsonResponse({token: 'pin hall', user: ME_A})},
    ])
    const res = await uiMisskeyPassword({origin: ORIGIN_A, flavor: 'pinetree', username: 'alice', password: 'pw'})
    expect(res.token).toBe('pin hall')
    expect(res.grant).toBe('password')
  })

  it('refuses to guess on pending extra steps', async () => {
    globalThis.fetch = scriptFetch([], [
      {match: url => url === `${ORIGIN_A}/api/signin-flow`, respond: () => jsonResponse({finished: false, next: 'captcha'})},
    ])
    await expect(
      uiMisskeyPassword({origin: ORIGIN_A, flavor: 'misskey', username: 'alice', password: 'pw'}),
    ).rejects.toThrow(/extra sign-in step/)
  })
})

describe('cross-origin token isolation (new token paths)', () => {
  it("A's native/app tokens never reach B's origin and vice versa", async () => {
    const calls: Array<{url: string; body: string}> = []
    const scriptA = misskeyScript(ORIGIN_A, {native: 'native-a', appToken: 'app-a', me: ME_A})
    const scriptB = misskeyScript(ORIGIN_B, {native: 'native-b', appToken: 'app-b', me: ME_B})
    globalThis.fetch = scriptFetch(calls, [...scriptA, ...scriptB])
    await uiMisskeyPassword({origin: ORIGIN_A, flavor: 'misskey', username: 'alice', password: 'pw'})
    await uiMisskeyPassword({origin: ORIGIN_B, flavor: 'sharkey', username: 'bob', password: 'pw'})

    const forOrigin = (origin: string) => calls.filter(c => c.url.startsWith(origin))
    expect(forOrigin(ORIGIN_A).length).toBeGreaterThan(0)
    expect(forOrigin(ORIGIN_B).length).toBeGreaterThan(0)
    for (const c of forOrigin(ORIGIN_A)) {
      expect(c.body).not.toContain('native-b')
      expect(c.body).not.toContain('app-b')
    }
    for (const c of forOrigin(ORIGIN_B)) {
      expect(c.body).not.toContain('native-a')
      expect(c.body).not.toContain('app-a')
    }
    // No request crossed origins at all.
    for (const c of calls) {
      expect(c.url.startsWith(ORIGIN_A) || c.url.startsWith(ORIGIN_B)).toBe(true)
    }
  })

  it('a Mastodon password grant Bearers only its own origin', async () => {
    const store: KeyValueStore = createMemoryStore()
    const calls: Array<{url: string; body: string; auth: string | null}> = []
    const meB = {id: 'masto-b', username: 'bob', acct: 'bob'}
    globalThis.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      calls.push({url, body: typeof init?.body === 'string' ? init.body : '', auth: headers.get('authorization')})
      if (url === `${ORIGIN_B}/api/v1/apps`) {
        return jsonResponse({client_id: 'cid', client_secret: 'csec'})
      }
      if (url === `${ORIGIN_B}/oauth/token`) {
        return jsonResponse({access_token: 'masto-token-b', token_type: 'Bearer', scope: 'read', created_at: 1})
      }
      if (url === `${ORIGIN_B}/api/v1/accounts/verify_credentials`) {
        return jsonResponse(meB)
      }
      throw new Error(`unexpected request ${url}`)
    }) as unknown as typeof fetch

    const redirectUri = `${ORIGIN_B}/auth/callback`
    const res = await uiMastodonPassword({appStore: store, origin: ORIGIN_B, redirectUri, username: 'bob', password: 'pw'})
    expect(res.token).toBe('masto-token-b')
    expect(res.account.id).toBe('masto-b')
    // verify_credentials carried the fresh Bearer for B's origin only.
    const verify = calls.find(c => c.url.endsWith('/verify_credentials'))
    expect(verify?.auth).toBe('Bearer masto-token-b')
    for (const c of calls) {
      expect(c.url.startsWith(ORIGIN_B)).toBe(true)
      expect(c.body).not.toContain('native-a')
      expect(c.auth === null || c.auth === 'Bearer masto-token-b').toBe(true)
    }
  })
})

describe('mastodon MFA + OAuth', () => {
  it('exposes the MFA second step', () => {
    expect(typeof mastodonMfaSignin).toBe('function')
  })

  it('surfaces MfaRequiredError for the screen to continue', async () => {
    const store: KeyValueStore = createMemoryStore()
    globalThis.fetch = jest.fn(async (input: unknown) => {
      const url = String(input)
      if (url === `${ORIGIN_B}/api/v1/apps`) {
        return jsonResponse({client_id: 'cid', client_secret: 'csec'})
      }
      if (url === `${ORIGIN_B}/oauth/token`) {
        return jsonResponse({error: 'mfa_required', mfa_token: 'mfa-t', supported_challenge_types: ['totp']}, 403)
      }
      throw new Error(`unexpected request ${url}`)
    }) as unknown as typeof fetch
    await expect(
      uiMastodonPassword({appStore: store, origin: ORIGIN_B, redirectUri: `${ORIGIN_B}/auth/callback`, username: 'bob', password: 'pw'}),
    ).rejects.toBeInstanceOf(MfaRequiredError)
  })

  it('start/complete round-trips state once (replay guard)', async () => {
    const store: KeyValueStore = createMemoryStore()
    globalThis.fetch = jest.fn(async (input: unknown) => {
      const url = String(input)
      if (url === `${ORIGIN_B}/api/v1/apps`) {
        return jsonResponse({client_id: 'cid', client_secret: 'csec'})
      }
      if (url === `${ORIGIN_B}/oauth/token`) {
        return jsonResponse({access_token: 'oauth-b', token_type: 'Bearer', scope: 'read', created_at: 1})
      }
      if (url === `${ORIGIN_B}/api/v1/accounts/verify_credentials`) {
        return jsonResponse({id: 'oauth-id', username: 'carol', acct: 'carol'})
      }
      throw new Error(`unexpected request ${url}`)
    }) as unknown as typeof fetch

    let opened: string | null = null
    await start({appStore: store, origin: ORIGIN_B, redirectUri: `${ORIGIN_B}/auth/callback`, openBrowser: (url: string) => { opened = url; return Promise.resolve() }})
    expect(opened).toContain(`${ORIGIN_B}/oauth/authorize`)
    const state = new URL(opened!).searchParams.get('state')!
    const code = 'auth-code'
    const done = await complete({appStore: store, code, state})
    expect(done?.origin).toBe(ORIGIN_B)
    expect(done?.token).toBe('oauth-b')
    // Replaying the same callback finds nothing.
    await expect(complete({appStore: store, code, state})).resolves.toBeNull()
  })

  it('requests the umbrella triple on mastodon flavor, the full set on akkoma (ADR 0005)', async () => {
    const calls: Array<{url: string; body: string}> = []
    globalThis.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      calls.push({url, body: typeof init?.body === 'string' ? init.body : ''})
      if (url === `${ORIGIN_B}/api/v1/apps`) {
        return jsonResponse({client_id: 'cid', client_secret: 'csec'})
      }
      throw new Error(`unexpected request ${url}`)
    }) as unknown as typeof fetch

    const redirectUri = `${ORIGIN_B}/auth/callback`
    let opened: string | null = null
    const openBrowser = (url: string) => {
      opened = url
      return Promise.resolve()
    }
    // Mastodon flavor: registration posts the triple plus `admin:read`
    // (slice 3.1 — the umbrella alone 403s the admin endpoints), the
    // authorize URL asks for it — still the short URL that fits tight
    // header buffers.
    await start({appStore: createMemoryStore(), origin: ORIGIN_B, redirectUri, openBrowser, flavor: 'mastodon'})
    expect(JSON.parse(calls[0].body)).toMatchObject({scopes: 'read write follow admin:read'})
    expect(new URL(opened!).searchParams.get('scope')).toBe('read write follow admin:read')

    // Akkoma flavor: the full NOW set (probe-proven requirement, ADR 0003).
    calls.length = 0
    await start({appStore: createMemoryStore(), origin: ORIGIN_B, redirectUri, openBrowser, flavor: 'akkoma'})
    const scopes = (JSON.parse(calls[0].body) as {scopes: string}).scopes
    expect(scopes.split(' ')).toContain('write:conversations')
    expect(scopes.split(' ')).toContain('write:reports')
    expect(new URL(opened!).searchParams.get('scope')).toBe(scopes)
  })

  it('the mastodon password grant carries the flavor scopes', async () => {
    const store: KeyValueStore = createMemoryStore()
    const calls: Array<{url: string; body: string}> = []
    globalThis.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      calls.push({url, body: String(init?.body ?? '')})
      if (url === `${ORIGIN_B}/api/v1/apps`) {
        return jsonResponse({client_id: 'cid', client_secret: 'csec'})
      }
      if (url === `${ORIGIN_B}/oauth/token`) {
        return jsonResponse({access_token: 'masto-token-b', token_type: 'Bearer', scope: 'read', created_at: 1})
      }
      if (url === `${ORIGIN_B}/api/v1/accounts/verify_credentials`) {
        return jsonResponse({id: 'masto-b', username: 'bob', acct: 'bob'})
      }
      throw new Error(`unexpected request ${url}`)
    }) as unknown as typeof fetch

    const redirectUri = `${ORIGIN_B}/auth/callback`
    // Akkoma path (the only password-grant flavor): full set on the token call.
    await uiMastodonPassword({appStore: store, origin: ORIGIN_B, redirectUri, username: 'bob', password: 'pw', flavor: 'akkoma'})
    const tokenCall = calls.find(c => c.url === `${ORIGIN_B}/oauth/token`)
    const form = new URLSearchParams(tokenCall!.body)
    expect(form.get('grant_type')).toBe('password')
    expect(form.get('scope')).toContain('write:conversations')
  })
})

describe('misskey MiAuth browser sign-in', () => {
  it('opens the instance approval page with a callback, persisting the pending row', async () => {
    const store: KeyValueStore = createMemoryStore()
    let opened: string | null = null
    const started = await startMisskeyMiAuth({
      pendingStore: store,
      origin: ORIGIN_A,
      redirectUri: 'https://app.example/auth/callback',
      openBrowser: (url: string) => {
        opened = url
        return Promise.resolve()
      },
    })
    expect(opened).toContain(`${ORIGIN_A}/miauth/${started.session}`)
    expect(opened).toContain(`callback=${encodeURIComponent('https://app.example/auth/callback')}`)
    expect(opened).toContain('name=Keystone')
    // The callback can name the origin from the persisted pending row.
    expect(takeMisskeyPending(store, started.session)).toMatchObject({
      scheme: 'https',
      host: 'a.example',
      session: started.session,
    })
    // Replaying the same session finds nothing.
    expect(takeMisskeyPending(store, started.session)).toBeNull()
  })

  it('polls the check endpoint, then verifies the issued token before returning', async () => {
    const calls: Array<{url: string; body: string}> = []
    let checks = 0
    globalThis.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      calls.push({url, body: typeof init?.body === 'string' ? init.body : ''})
      if (url.startsWith(`${ORIGIN_A}/api/miauth/`) && url.endsWith('/check')) {
        checks += 1
        return jsonResponse(checks < 2 ? {ok: false} : {ok: true, token: 'miauth-token'})
      }
      if (url === `${ORIGIN_A}/api/i`) {
        return jsonResponse(ME_A)
      }
      throw new Error(`unexpected request ${url}`)
    }) as unknown as typeof fetch

    const done = await pollMisskeyApproval({
      scheme: 'https',
      host: 'a.example',
      session: 'sess-1',
      intervalMs: 1,
    })
    expect(done.origin).toBe(ORIGIN_A)
    expect(done.token).toBe('miauth-token')
    expect(done.account.id).toBe('alice-id')
    expect(checks).toBe(2)
    // Verify-before-store: the `i` check ran with the issued token.
    const verify = calls.find(c => c.url === `${ORIGIN_A}/api/i`)
    expect(JSON.parse(verify!.body)).toEqual({i: 'miauth-token'})
    // Nothing crossed origins.
    for (const c of calls) {
      expect(c.url.startsWith(ORIGIN_A)).toBe(true)
    }
  })

  it('throws an honest timeout when approval never lands', async () => {
    globalThis.fetch = jest.fn(async () => jsonResponse({ok: false})) as unknown as typeof fetch
    await expect(
      pollMisskeyApproval({scheme: 'https', host: 'a.example', session: 'sess-2', attempts: 2, intervalMs: 1}),
    ).rejects.toThrow(/not completed in time/)
  })

  it('rejects expired pendings', async () => {
    const store: KeyValueStore = createMemoryStore()
    store.setItem(
      'keystone_pending_miauth_old',
      JSON.stringify({scheme: 'https', host: 'a.example', session: 'old', createdAt: 0}),
    )
    expect(takeMisskeyPending(store, 'old')).toBeNull()
  })
})
