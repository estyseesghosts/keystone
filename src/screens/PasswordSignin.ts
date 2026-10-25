import {
  type Account,
  type DetectionEvidence,
  type KeyValueStore,
  type ServerFamily,
  type ServerFlavor,
  type SessionGrant,
  type SessionHosting,
} from '@keystone/fedi'

import {
  mastodonMfaSignin,
  mastodonPasswordSignin,
  misskeyPasswordSignin,
} from './LoginFlows'

// Shared password-signin exchange (grouped-params answer to the D3.7
// "8+-param helper" objection — one options bag, D3.8 idiom — mirroring
// the `MastodonCallback.ts` precedent): the Login screen's internal and
// external password/MFA submits all funnel through here, so the exchange
// assembly lives in one implementation and the call sites stay thin.
// Verification still happens BEFORE the caller stores anything; the
// returned payload feeds the screen's `finish` unchanged. `MfaRequiredError`
// propagates — the screen maps it onto its MFA step, exactly as before.

/** Password-grant attempt: Misskey needs no app store, Mastodon does. */
export type PasswordSigninRequest =
  | {
      family: 'misskey'
      origin: string
      flavor: ServerFlavor
      hosting: 'first-party' | 'third-party'
      evidence: DetectionEvidence | null
      username: string
      password: string
    }
  | {
      family: 'mastodon'
      origin: string
      flavor: ServerFlavor
      hosting: 'first-party' | 'third-party'
      evidence: DetectionEvidence | null
      username: string
      password: string
      appStore: KeyValueStore
      redirectUri: string
    }

/** Verified session payload — the shape the screen's `finish` stores. */
export interface PasswordSigninDone {
  origin: string
  family: ServerFamily
  flavor: ServerFlavor
  token: string
  account: Account
  grant: SessionGrant
  hosting: SessionHosting
  evidence: DetectionEvidence | null
}

/** MFA second step (Mastodon-family only): the challenge the grant raised. */
export interface MfaSigninRequest {
  origin: string
  flavor: ServerFlavor
  hosting: 'first-party' | 'third-party'
  evidence: DetectionEvidence | null
  mfaToken: string
  challengeTypes: string[]
  code: string
  appStore: KeyValueStore
  redirectUri: string
}

export async function completePasswordSignin(
  req: PasswordSigninRequest,
): Promise<PasswordSigninDone> {
  if (req.family === 'misskey') {
    const res = await misskeyPasswordSignin({
      origin: req.origin,
      flavor: req.flavor,
      username: req.username,
      password: req.password,
    })
    return {
      origin: req.origin,
      family: 'misskey',
      flavor: req.flavor,
      token: res.token,
      account: res.account,
      grant: res.grant,
      hosting: req.hosting,
      evidence: req.evidence,
    }
  }
  const res = await mastodonPasswordSignin({
    appStore: req.appStore,
    origin: req.origin,
    redirectUri: req.redirectUri,
    username: req.username,
    password: req.password,
    flavor: req.flavor,
  })
  return {
    origin: req.origin,
    family: 'mastodon',
    flavor: req.flavor,
    token: res.token,
    account: res.account,
    grant: res.grant,
    hosting: req.hosting,
    evidence: req.evidence,
  }
}

export async function completeMfaSignin(req: MfaSigninRequest): Promise<PasswordSigninDone> {
  const res = await mastodonMfaSignin({
    appStore: req.appStore,
    origin: req.origin,
    redirectUri: req.redirectUri,
    mfaToken: req.mfaToken,
    challengeType: req.challengeTypes[0] ?? 'totp',
    code: req.code,
    flavor: req.flavor,
  })
  return {
    origin: req.origin,
    family: 'mastodon',
    flavor: req.flavor,
    token: res.token,
    account: res.account,
    grant: res.grant,
    hosting: req.hosting,
    evidence: req.evidence,
  }
}
