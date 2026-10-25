import {
  detectServer,
  type Account,
  type DetectionEvidence,
  type KeyValueStore,
  type ServerFlavor,
} from '@keystone/fedi'

import {completeMastodonOAuth} from './LoginFlows'

export interface MastodonCallbackDone {
  origin: string
  token: string
  account: Account
  flavor: ServerFlavor
  evidence: DetectionEvidence | null
}

/**
 * Shared Mastodon-family OAuth completion (D3.7 dedupe of Login's
 * `finishOAuthCallbackUrl` and the AuthCallback link path): exchange the
 * one-time code/state (read-and-delete replay guard — null when the state
 * is unknown, malformed, expired, or already consumed), then refine the
 * flavor/evidence with a best-effort detect. Verification happens BEFORE
 * the caller stores anything. Returns null when the other path owns the
 * session (replay) — callers treat that as "keep waiting" (Login inline)
 * or "link already ran" (AuthCallback).
 */
export async function completeMastodonCallback(opts: {
  appStore: KeyValueStore
  code: string
  state: string
}): Promise<MastodonCallbackDone | null> {
  const done = await completeMastodonOAuth({
    appStore: opts.appStore,
    code: opts.code,
    state: opts.state,
  })
  if (!done) return null // replay: the other path owns it
  let flavor: ServerFlavor = 'unknown'
  let evidence: DetectionEvidence | null = null
  try {
    const found = await detectServer(done.origin)
    if (found.family === 'mastodon') flavor = found.flavor
    evidence = found.evidence
  } catch {
    // Flavor refines later; the verified session stores regardless.
  }
  return {
    origin: done.origin,
    token: done.token,
    account: done.account,
    flavor,
    evidence,
  }
}
