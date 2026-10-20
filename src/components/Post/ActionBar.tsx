// Post action bar (slice 4.2): reply, boost (+quote), like/react, more.
// Presentational over `usePostActions` (4.1) results; every control is
// gated and either works or is disabled/hidden with its reason.

import {StyleSheet, View} from 'react-native'

import type {Capabilities, Post, ServerFamily} from '@keystone/fedi'

import {Button} from '#/components/Button'
import {Menu, type MenuItem} from '#/components/Menu'
import {likeKind, type PostActions} from '#/state/cache'
import {showToast} from '#/lib/toast'

import type {PostCardHandlers} from './handlers'
import {PostMenu} from './PostMenu'
import type {PostMenuSection} from './menuModel'

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center'},
})

const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong.')
export const toastError = (e: unknown): void => {
  showToast(msg(e))
}

export function ActionBar({
  post,
  actions,
  family,
  capabilities,
  handlers,
  menu,
}: {
  /** The shown (appeared) post — shadow-merged for display. */
  post: Post
  actions: PostActions
  family: ServerFamily
  capabilities: Capabilities | null
  handlers: PostCardHandlers
  menu: PostMenuSection[]
}) {
  const id = post.id
  const kind = likeKind(family, capabilities)

  const boosted = actions.renote.value
  const boostItems: MenuItem[] = [
    {
      key: 'boost',
      label: boosted ? 'Undo boost' : 'Boost',
      disabled: !actions.renote.gate.enabled,
      reason: actions.renote.gate.enabled ? undefined : actions.renote.gate.reason,
      onSelect: () => void actions.renote.set(!boosted).catch(toastError),
    },
  ]
  const canQuote = capabilities?.quote_posting === 'supported'
  boostItems.push(
    canQuote && handlers.onQuote
      ? {key: 'quote', label: 'Quote', onSelect: () => handlers.onQuote!(post)}
      : {
          key: 'quote',
          label: 'Quote',
          disabled: true,
          reason: canQuote ? 'No composer is connected to this view.' : 'This server does not support quote posts.',
          onSelect: () => {},
        },
  )

  let like: React.ReactNode = null
  if (kind === 'favourite') {
    const on = actions.favourite.value
    like = (
      <Button
        testID={`action-like-${id}`}
        label={on ? 'Unlike' : 'Like'}
        variant="secondary"
        disabled={!actions.favourite.gate.enabled}
        disabledReason={actions.favourite.gate.enabled ? undefined : actions.favourite.gate.reason}
        onPress={() => void actions.favourite.set(!on).catch(toastError)}
      />
    )
  } else if (kind === 'reaction') {
    const mine = actions.reaction.value
    const gate = actions.reaction.gate
    const canPick = !!handlers.onPickReaction
    like = (
      <Button
        testID={`action-react-${id}`}
        label={mine ? 'Remove reaction' : 'React'}
        variant="secondary"
        disabled={!gate.enabled || (!mine && !canPick)}
        disabledReason={
          !gate.enabled
            ? gate.reason
            : !mine && !canPick
              ? 'No emoji picker is connected here; tap a reaction chip instead.'
              : undefined
        }
        onPress={() => {
          if (mine) void actions.reaction.set(null).catch(toastError)
          else handlers.onPickReaction?.(post, (key, url) => actions.reaction.setWithArt(key, url).catch(toastError))
        }}
      />
    )
  }

  return (
    <View style={styles.row} testID={`post-actions-${id}`}>
      <Button
        testID={`action-reply-${id}`}
        label="Reply"
        variant="secondary"
        disabled={!handlers.onReply}
        disabledReason={handlers.onReply ? undefined : 'No composer is connected to this view.'}
        onPress={() => handlers.onReply?.(post)}
      />
      <Menu testID={`action-boost-${id}`} label={boosted ? 'Boosted' : 'Boost'} items={boostItems} />
      {like}
      <PostMenu postId={id} sections={menu} />
    </View>
  )
}
