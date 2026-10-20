import {useState} from 'react'
import {View} from 'react-native'

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

const LABEL: Record<FollowButtonState, string> = {
  follow: 'Follow',
  following: 'Following',
  requested: 'Requested',
  follow_back: 'Follow back',
  blocked: 'Blocked you',
  unblock: 'Unblock',
}

export function ProfileActions({sessionId, account}: {sessionId: string; account: Account}) {
  const rel = useRelationship(sessionId, account.id)
  const actions = useGraphActions(sessionId, {id: account.id, locked: account.locked})
  const soft = useSoftMute(sessionId, account.id)
  const [error, setError] = useState<string | null>(null)
  const [listsOpen, setListsOpen] = useState(false)
  const relationship: Relationship | null = rel.data ?? null
  const state = followButtonState(relationship)
  const run = (p: Promise<void>) => {
    setError(null)
    p.catch(e => setError(e instanceof Error ? e.message : 'That did not work.'))
  }

  const blockedByThem = state === 'blocked'
  const followGate = actions.follow.gate
  const followDisabled = !followGate.enabled || blockedByThem
  const followReason = !followGate.enabled ? followGate.reason : blockedByThem ? 'This account has blocked you.' : undefined

  const onFollow = () => {
    if (state === 'unblock') return run(actions.block.set(false))
    run(actions.follow.set(state === 'following' || state === 'requested' ? 'none' : 'following'))
  }

  const items: MenuItem[] = [
    {
      key: 'mute',
      label: relationship?.isMuted ? 'Unmute' : 'Mute',
      disabled: !actions.mute.gate.enabled,
      reason: actions.mute.gate.enabled ? undefined : actions.mute.gate.reason,
      onSelect: () => run(actions.mute.set(!relationship?.isMuted)),
    },
    {
      key: 'block',
      label: relationship?.isBlocking ? 'Unblock' : 'Block',
      disabled: !actions.block.gate.enabled,
      reason: actions.block.gate.enabled ? undefined : actions.block.gate.reason,
      onSelect: () => run(actions.block.set(!relationship?.isBlocking)),
    },
    {
      key: 'soft-mute',
      label: soft.muted ? 'Stop hiding on this device' : 'Hide on this device',
      onSelect: () => soft.set(!soft.muted),
    },
    {
      key: 'lists',
      label: 'Add to list…',
      disabled: !actions.lists.gate.enabled,
      reason: actions.lists.gate.enabled ? undefined : actions.lists.gate.reason,
      onSelect: () => setListsOpen(true),
    },
  ]

  return (
    <View style={[atoms.gap_sm]} testID="profile-actions">
      {relationship?.hasPendingFollowRequestToYou ? (
        <View style={[atoms.row, atoms.gap_sm]} testID="profile-request-row">
          <Caption color="faint">Wants to follow you.</Caption>
          <Button label="Accept" disabled={!actions.followRequest.gate.enabled} onPress={() => run(actions.followRequest.resolve(true))} testID="profile-request-accept" />
          <Button label="Reject" variant="secondary" disabled={!actions.followRequest.gate.enabled} onPress={() => run(actions.followRequest.resolve(false))} testID="profile-request-reject" />
        </View>
      ) : null}
      <View style={[atoms.row, atoms.gap_sm]}>
        <Button
          label={LABEL[state]}
          variant={state === 'following' || state === 'requested' ? 'secondary' : 'primary'}
          disabled={followDisabled && state !== 'unblock'}
          disabledReason={followReason}
          onPress={onFollow}
          testID="profile-follow"
        />
        <Menu label="More" items={items} testID="profile-more" />
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
  const [lists, setLists] = useState<Array<{id: string; name: string}> | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [started, setStarted] = useState(false)
  if (!started && backend?.lists) {
    setStarted(true)
    backend.lists.list().then(setLists, () => setLoadError(true))
  }
  const ids = member.data ?? []
  return (
    <Dialog open onClose={onClose} title="Add to list" testID="list-membership-dialog">
      <View style={atoms.gap_sm}>
        {loadError ? <Body>Could not load your lists.</Body> : null}
        {lists && lists.length === 0 ? <Body>You have no lists yet.</Body> : null}
        {(lists ?? []).map(l => {
          const inList = ids.includes(l.id)
          return (
            <Button
              key={l.id}
              label={`${inList ? 'Remove from' : 'Add to'} ${l.name}`}
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
