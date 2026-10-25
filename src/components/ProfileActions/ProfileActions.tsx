import {useState} from 'react'
import {View} from 'react-native'
import {msg} from '@lingui/macro'
import {useI18n} from '#/locale/i18n'
import type {I18n} from '@lingui/core'

import type {Account} from '@keystone/fedi'
import {followButtonState, type FollowButtonState, type Relationship} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Dialog} from '#/components/Dialog'
import {Menu, type MenuItem} from '#/components/Menu'
import {useBackendForSessionId} from '#/screens/HomeFeed'
import {useGraphActions, useListMembership, useRelationship, useSoftMute} from '#/state/queries/graph'

// Profile actions (slice 4.4): follow button (follow / following /
// requested / follow back / blocked), incoming-request accept/reject,
// and a menu with mute, block, soft mute (local), add to list. Every
// control is gated by capabilities/relationship and shows a reason when
// disabled; nothing is inert.

// Follow-button labels, resolved at render time (a module constant would
// freeze the boot locale — the locale switches at runtime).
function followActionLabel(i18n: I18n, state: FollowButtonState): string {
  switch (state) {
    case 'follow':
      return i18n._(msg`Follow`)
    case 'following':
      return i18n._(msg`Following`)
    case 'requested':
      return i18n._(msg`Requested`)
    case 'follow_back':
      return i18n._(msg`Follow back`)
    case 'blocked':
      return i18n._(msg`Blocked you`)
    case 'unblock':
      return i18n._(msg`Unblock`)
  }
}

export function ProfileActions({sessionId, account}: {sessionId: string; account: Account}) {
  const rel = useRelationship(sessionId, account.id)
  const actions = useGraphActions(sessionId, {id: account.id, locked: account.locked})
  const soft = useSoftMute(sessionId, account.id)
  const i18n = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [listsOpen, setListsOpen] = useState(false)
  const relationship: Relationship | null = rel.data ?? null
  const state = followButtonState(relationship)
  const run = (p: Promise<void>) => {
    setError(null)
    p.catch(e => setError(e instanceof Error ? e.message : i18n._(msg`That did not work.`)))
  }

  const blockedByThem = state === 'blocked'
  const followGate = actions.follow.gate
  const followDisabled = !followGate.enabled || blockedByThem
  const followReason = !followGate.enabled
    ? followGate.reason
    : blockedByThem
      ? i18n._(msg`This account has blocked you.`)
      : undefined

  const onFollow = () => {
    if (state === 'unblock') return run(actions.block.set(false))
    run(actions.follow.set(state === 'following' || state === 'requested' ? 'none' : 'following'))
  }

  const items: MenuItem[] = [
    {
      key: 'mute',
      label: relationship?.isMuted ? i18n._(msg`Unmute`) : i18n._(msg`Mute`),
      disabled: !actions.mute.gate.enabled,
      reason: actions.mute.gate.enabled ? undefined : actions.mute.gate.reason,
      onSelect: () => run(actions.mute.set(!relationship?.isMuted)),
    },
    {
      key: 'block',
      label: relationship?.isBlocking ? i18n._(msg`Unblock`) : i18n._(msg`Block`),
      disabled: !actions.block.gate.enabled,
      reason: actions.block.gate.enabled ? undefined : actions.block.gate.reason,
      onSelect: () => run(actions.block.set(!relationship?.isBlocking)),
    },
    {
      key: 'soft-mute',
      label: soft.muted ? i18n._(msg`Stop hiding on this device`) : i18n._(msg`Hide on this device`),
      onSelect: () => soft.set(!soft.muted),
    },
    {
      key: 'lists',
      label: i18n._(msg`Add to list…`),
      disabled: !actions.lists.gate.enabled,
      reason: actions.lists.gate.enabled ? undefined : actions.lists.gate.reason,
      onSelect: () => setListsOpen(true),
    },
  ]

  return (
    <View style={[atoms.gap_sm]} testID="profile-actions">
      {relationship?.hasPendingFollowRequestToYou ? (
        <View style={[atoms.row, atoms.gap_sm]} testID="profile-request-row">
          <Caption color="faint">{i18n._(msg`Wants to follow you.`)}</Caption>
          <Button label={i18n._(msg`Accept`)} disabled={!actions.followRequest.gate.enabled} onPress={() => run(actions.followRequest.resolve(true))} testID="profile-request-accept" />
          <Button label={i18n._(msg`Reject`)} variant="secondary" disabled={!actions.followRequest.gate.enabled} onPress={() => run(actions.followRequest.resolve(false))} testID="profile-request-reject" />
        </View>
      ) : null}
      <View style={[atoms.row, atoms.gap_sm]}>
        <Button
          label={followActionLabel(i18n, state)}
          variant={state === 'following' || state === 'requested' ? 'secondary' : 'primary'}
          disabled={followDisabled && state !== 'unblock'}
          disabledReason={followReason}
          onPress={onFollow}
          testID="profile-follow"
        />
        <Menu label={i18n._(msg`More`)} items={items} testID="profile-more" />
      </View>
      {followReason ? <Caption color="faint">{followReason}</Caption> : null}
      {error ? <Caption color="faint" testID="profile-actions-error">{error}</Caption> : null}
      {listsOpen ? (
        <ListMembershipDialog sessionId={sessionId} account={account} onClose={() => setListsOpen(false)} run={run} />
      ) : null}
    </View>
  )
}

function ListMembershipDialog({
  sessionId,
  account,
  onClose,
  run,
}: {
  sessionId: string
  account: Account
  onClose: () => void
  run: (p: Promise<void>) => void
}) {
  const backend = useBackendForSessionId(sessionId)
  const actions = useGraphActions(sessionId, {id: account.id, locked: account.locked})
  const member = useListMembership(sessionId, account.id)
  const i18n = useI18n()
  const [lists, setLists] = useState<Array<{id: string; name: string}> | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [started, setStarted] = useState(false)
  if (!started && backend?.lists) {
    setStarted(true)
    backend.lists.list().then(setLists, () => setLoadError(true))
  }
  const ids = member.data ?? []
  return (
    <Dialog open onClose={onClose} title={i18n._(msg`Add to list`)} testID="list-membership-dialog">
      <View style={atoms.gap_sm}>
        {loadError ? <Body>{i18n._(msg`Could not load your lists.`)}</Body> : null}
        {lists && lists.length === 0 ? <Body>{i18n._(msg`You have no lists yet.`)}</Body> : null}
        {(lists ?? []).map(l => {
          const inList = ids.includes(l.id)
          return (
            <Button
              key={l.id}
              label={inList ? i18n._(msg`Remove from ${l.name}`) : i18n._(msg`Add to ${l.name}`)}
              variant={inList ? 'secondary' : 'primary'}
              disabled={!actions.lists.gate.enabled}
              onPress={() => run(actions.lists.set(l.id, !inList))}
              testID={`list-toggle-${l.id}`}
            />
          )
        })}
      </View>
    </Dialog>
  )
}
