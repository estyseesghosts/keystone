// Incoming follow-requests queue (`/follow-requests`, v1 `FollowRequests`
// parity): the rows come from `backend.followRequests()` (both families
// pack follower + followee), accept/reject goes through the graph
// controller's `followRequest.resolve` (optimistic where the controller
// provides it), and the queue reloads after each decision. Signed-out,
// empty, error/retry, and unsupported-gate states are all honest — no
// new backend surface.

import {useCallback, useEffect, useState} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'

import {msg} from '@lingui/macro'

import {
  displayNameOf,
  handleOf,
  isUnsupportedError,
  type FollowRequest,
} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {SkeletonList} from '#/components/Skeleton'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import {useActiveBackend} from '#/screens/HomeFeed'
import {useGraphActions} from '#/state/queries/graph'
import {errorText} from '#/lib/localeErrors'
import {i18n} from '#/locale/i18n'

function RequestRow({
  sessionId,
  request,
  onResolved,
}: {
  sessionId: string
  request: FollowRequest
  onResolved: (id: string) => void
}) {
  const follower = request.follower
  const actions = useGraphActions(sessionId, {id: follower.id, locked: follower.locked})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const gate = actions.followRequest.gate

  const decide = async (accept: boolean) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await actions.followRequest.resolve(accept)
      onResolved(request.id)
    } catch (err) {
      setError(errorText(i18n, err, i18n._(msg`Could not answer the request.`)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]} testID={`follow-request-${request.id}`}>
      <View style={[atoms.gap_sm]}>
        <Body>{displayNameOf(follower)}</Body>
        <Caption color="faint">{handleOf(follower)}</Caption>
      </View>
      <View style={[atoms.row, atoms.gap_sm]}>
        <Button
          label={
            busy
              ? i18n._(msg({message: 'Working…', context: 'button'}))
              : i18n._(msg({message: 'Accept', context: 'button', comment: 'Accept a follow request'}))
          }
          variant="primary"
          disabled={busy || !gate.enabled}
          disabledReason={gate.enabled ? undefined : gate.reason}
          onPress={() => void decide(true)}
          testID={`follow-request-accept-${request.id}`}
        />
        <Button
          label={
            busy
              ? i18n._(msg({message: 'Working…', context: 'button'}))
              : i18n._(msg({message: 'Reject', context: 'button', comment: 'Reject a follow request'}))
          }
          variant="secondary"
          disabled={busy || !gate.enabled}
          disabledReason={gate.enabled ? undefined : gate.reason}
          onPress={() => void decide(false)}
          testID={`follow-request-reject-${request.id}`}
        />
      </View>
      {!gate.enabled ? <Caption color="faint">{gate.reason}</Caption> : null}
      {error ? <Caption color="faint">{error}</Caption> : null}
    </View>
  )
}

export function FollowRequestsScreen() {
  const theme = useTheme()
  const {session, backend} = useActiveBackend()
  const [items, setItems] = useState<FollowRequest[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [unsupported, setUnsupported] = useState(false)

  const load = useCallback(async () => {
    if (!session || !backend) {
      setLoading(false)
      return
    }
    setFetching(true)
    setError(null)
    try {
      setItems(await backend.followRequests())
      setUnsupported(false)
    } catch (err) {
      if (isUnsupportedError(err)) setUnsupported(true)
      else setError(err)
    } finally {
      setLoading(false)
      setFetching(false)
    }
  }, [session, backend])

  useEffect(() => {
    setItems(null)
    setUnsupported(false)
    setError(null)
    setLoading(true)
    void load()
  }, [load])

  const onResolved = useCallback((id: string) => {
    setItems(prev => (prev ?? []).filter(r => r.id !== id))
  }, [])

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="follow-requests-screen">
        <Pagehead title={i18n._(msg({id: 'followRequests.title', message: 'Follows', context: 'follow requests screen'}))} />
        <Body>{i18n._(msg({id: 'followRequests.signedOut', message: 'Sign in to see follow requests.'}))}</Body>
        <Caption color="faint">
          {i18n._(msg`Requests never show sample data when signed out.`)}
        </Caption>
        <SignInButton />
      </View>
    )
  }

  if (unsupported) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="follow-requests-screen">
        <Pagehead title={i18n._(msg({id: 'followRequests.title', message: 'Follows', context: 'follow requests screen'}))} />
        <Body>{i18n._(msg`Follow requests are not available on this server.`)}</Body>
      </View>
    )
  }

  return (
    <View style={atoms.flex1} testID="follow-requests-screen">
      <Pagehead title={i18n._(msg({id: 'followRequests.title', message: 'Follows', context: 'follow requests screen'}))} />
      {loading ? (
        <SkeletonList variant="account" testID="follow-requests-loading" />
      ) : error ? (
        <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
          <Body>{i18n._(msg`Could not load follow requests.`)}</Body>
          <Button
            label={i18n._(msg({message: 'Retry', context: 'button', comment: 'Retry loading follow requests'}))}
            variant="secondary"
            onPress={() => void load()}
            testID="follow-requests-retry"
          />
        </View>
      ) : (
        <FlatList
          data={items ?? []}
          keyExtractor={item => item.id}
          renderItem={({item}) => (
            <RequestRow sessionId={session.id} request={item} onResolved={onResolved} />
          )}
          refreshControl={
            <RefreshControl
              refreshing={fetching}
              onRefresh={() => void load()}
              testID="follow-requests-refresh"
              tintColor={theme.palette.muted}
              colors={[theme.palette.muted]}
              progressBackgroundColor={theme.palette.bg}
            />
          }
          ListEmptyComponent={
            <View style={[atoms.centered, atoms.p_md]}>
              <Body>{i18n._(msg({id: 'followRequests.empty', message: 'No follow requests.'}))}</Body>
            </View>
          }
        />
      )}
    </View>
  )
}
