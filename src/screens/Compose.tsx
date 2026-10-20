import {useEffect, useState} from 'react'
import {View} from 'react-native'
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native'

import type {Post} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Composer} from '#/components/Composer'
import {Loader} from '#/components/Loader'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'
import {appStorage} from '#/storage'

// Compose route (slice 4.3): modal wrapper that resolves the reply/quote
// target posts through the ACTIVE session's backend, then mounts the
// Composer. Params: replyToId, quoteId, draftId.
export function ComposeScreen() {
  const route = useRoute<RouteProp<RootParamList, 'Compose'>>()
  const nav = useNavigation()
  const {session, backend} = useActiveBackend()
  const {replyToId, quoteId, draftId} = route.params ?? {}
  const [targets, setTargets] = useState<{replyTo: Post | null; quote: Post | null} | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    if (!backend) return
    let cancelled = false
    setTargets(null)
    setFailed(null)
    Promise.all([
      replyToId ? backend.post(replyToId) : Promise.resolve(null),
      quoteId ? backend.post(quoteId) : Promise.resolve(null),
    ]).then(
      ([replyTo, quote]) => !cancelled && setTargets({replyTo, quote}),
      err => !cancelled && setFailed(err instanceof Error ? err.message : 'Could not load the post.'),
    )
    return () => {
      cancelled = true
    }
  }, [backend, session?.id, replyToId, quoteId])

  const close = () => (nav.canGoBack() ? nav.goBack() : undefined)

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md, atoms.gap_md]}>
        <Body>Sign in to post.</Body>
        <Button label="Close" variant="secondary" onPress={close} />
      </View>
    )
  }
  if (failed) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md, atoms.gap_md]}>
        <Body>{failed}</Body>
        <Button label="Close" variant="secondary" onPress={close} />
      </View>
    )
  }
  if (!targets) {
    return (
      <View style={[atoms.flex1, atoms.centered]}>
        <Loader />
      </View>
    )
  }
  return (
    <View style={atoms.flex1}>
      <Composer
        // Remount when the account or target changes: state never carries across.
        key={`${session.id}|${replyToId ?? ''}|${quoteId ?? ''}|${draftId ?? ''}`}
        session={session}
        backend={backend}
        store={appStorage()}
        replyTo={targets.replyTo}
        quote={targets.quote}
        draftId={draftId ?? null}
        onClose={close}
      />
    </View>
  )
}
