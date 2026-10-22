import {messagingUnavailableReason} from '#/lib/messaging'

describe('messaging gate reason (0.9, per-flavor by P6.2)', () => {
  it('names the client gap, never a server limitation (generic path)', () => {
    const reason = messagingUnavailableReason()
    expect(reason).toMatch(/not implemented in Keystone yet/i)
    expect(reason).toMatch(/this client has no DM or chat screen/i)
    expect(reason).not.toMatch(/this server (does not|doesn't|cannot|has no)/i)
  })

  it('names the server gap on pinetree (no chat there)', () => {
    const reason = messagingUnavailableReason({family: 'misskey', flavor: 'pinetree'})
    expect(reason).toMatch(/no chat/i)
    expect(reason).not.toMatch(/not implemented in Keystone yet/i)
  })

  it('names the unverified client gap on catodon', () => {
    const reason = messagingUnavailableReason({family: 'misskey', flavor: 'catodon'})
    expect(reason).toMatch(/unverified/i)
    expect(reason).not.toMatch(/this server has no/i)
  })

  it('keeps a generic client-gap sentence for misskey/sharkey past the gate', () => {
    for (const flavor of ['misskey', 'sharkey'] as const) {
      const reason = messagingUnavailableReason({family: 'misskey', flavor})
      expect(reason).toMatch(/not implemented in Keystone yet/i)
      expect(reason).not.toMatch(/this server (does not|doesn't|cannot|has no)/i)
    }
  })

  it('keeps the honest server reason on akkoma/pleroma without conversation support', () => {
    for (const flavor of ['akkoma', 'pleroma'] as const) {
      const reason = messagingUnavailableReason({family: 'mastodon', flavor})
      expect(reason).toMatch(/no DM inbox/i)
    }
  })
})
