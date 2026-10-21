// Account reactions block (C14): one account's recent reactions
// (`users/reactions` on the Misskey family). The Mastodon family has no
// equivalent — favourites are never repackaged as reactions — so the
// backend throws an honest 404 `unsupported` and this block renders the
// "not on this server" state instead of an error.
//
// ProfileHeader receives no backend (frozen props), so this lives as a
// standalone block taking its own `backend` prop: the coordinator mounts
// `<AccountReactionsBlock backend={backend} accountId={id} />` below the
// header. Import path: `#/components/Profile/AccountReactions`.
import {useEffect, useState} from 'react'
import {View} from 'react-native'

import {
  isUnsupportedError,
  type Backend,
  type UserReaction,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'

type Status = 'loading' | 'ready' | 'unsupported' | 'error'

export function AccountReactionsBlock({
  backend,
  accountId,
}: {
  backend: Backend
  accountId: string
}) {
  const [status, setStatus] = useState<Status>('loading')
  const [items, setItems] = useState<UserReaction[]>([])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setItems([])
    // `accountReactions` is required on the Backend interface but the
    // Mastodon backend answers with an honest `unsupported` 404; the
    // guard below also covers future backends that omit it entirely.
    const run = backend.accountReactions
    if (typeof run !== 'function') {
      setStatus('unsupported')
      return () => {
        cancelled = true
      }
    }
    run
      .call(backend, accountId, {limit: 20})
      .then(
        page => {
          if (cancelled) return
          setItems(page.items)
          setStatus('ready')
        },
        err => {
          if (cancelled) return
          setStatus(isUnsupportedError(err) ? 'unsupported' : 'error')
        },
      )
    return () => {
      cancelled = true
    }
  }, [backend, accountId])

  if (status === 'loading') {
    return (
      <View testID="account-reactions" style={atoms.p_md}>
        <Caption color="faint">Loading reactions.</Caption>
      </View>
    )
  }
  if (status === 'unsupported') {
    return (
      <View testID="account-reactions" style={atoms.p_md}>
        <Caption color="faint" testID="account-reactions-unavailable">
          Reactions are not available on this server.
        </Caption>
      </View>
    )
  }
  if (status === 'error') {
    return (
      <View testID="account-reactions" style={atoms.p_md}>
        <Caption color="faint" testID="account-reactions-error">
          Could not load reactions.
        </Caption>
      </View>
    )
  }
  if (items.length === 0) return null
  return (
    <View testID="account-reactions" style={[atoms.px_md, atoms.gap_sm]}>
      <Caption color="faint">Recent reactions</Caption>
      {items.map(r => (
        <View key={r.id} testID={`account-reaction-${r.id}`} style={atoms.gap_sm}>
          <Body>{r.reaction}</Body>
          <Caption color="faint">
            {r.post ? r.post.content.plain.slice(0, 120) : 'A note you cannot see.'}
          </Caption>
        </View>
      ))}
    </View>
  )
}
