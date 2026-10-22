import {messagingUnavailableReason} from '#/lib/messaging'

describe('messaging gate reason (0.9)', () => {
  it('names the client gap, never a server limitation', () => {
    const reason = messagingUnavailableReason()
    expect(reason).toMatch(/not implemented in Keystone yet/i)
    expect(reason).toMatch(/this client has no DM or chat screen/i)
    expect(reason).not.toMatch(/this server (does not|doesn't|cannot|has no)/i)
  })
})
