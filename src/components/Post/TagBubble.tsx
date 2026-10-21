// Tag-block bubble (F10, v1 `TagBubble` parity): `(#first +N)` in the card
// header, opening a floating panel with the pruned block tags. Tags route
// to the tag view on press. Renders nothing when there are no blocks —
// lone hashtags stay inline only, never in a bubble.
import {useRef, useState} from 'react'
import {StyleSheet, View, type View as ViewType} from 'react-native'

import {msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'

import {useTheme} from '#/alf/index'
import {Caption} from '#/alf/typography'
import {AnchoredPopup, PopupHead, PopupRow} from '#/components/Popup'
import {Pressable} from '#/components/Pressable'
import {navigationRef} from '#/navigationRef'

/** Default tag navigation (PostCard parity): the tag route, guarded for
 * provider-less trees where navigation is a silent no-op. */
function openTagPosts(tag: string): void {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Tag', {tag} as never)
}

const styles = StyleSheet.create({
  bubble: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
})

export function TagBubble({
  tags,
  onHashtagPress,
  testID,
}: {
  /** Pruned block tags (MFM posts) or every tag (HTML posts) — the bubble
   * set from `postTagBubble`. Empty renders nothing. */
  tags: string[]
  onHashtagPress?: (tag: string) => void
  testID?: string
}) {
  const {i18n} = useLingui()
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const anchor = useRef<ViewType | null>(null)
  if (tags.length === 0) return null
  const first = tags[0] ?? ''
  const rest = tags.length - 1
  const label = rest > 0 ? `(#${first} +${rest})` : `#${first}`
  const select = (tag: string) => {
    if (onHashtagPress) onHashtagPress(tag)
    else openTagPosts(tag)
    setOpen(false)
  }
  return (
    <>
      <View ref={anchor} collapsable={false}>
        <Pressable
          testID={testID}
          onPress={() => setOpen(v => !v)}
          accessibilityRole="button"
          accessibilityState={{expanded: open}}
          accessibilityLabel={i18n._(msg`Show tags`)}>
          <View style={[styles.bubble, {borderColor: theme.palette.edge}]}>
            <Caption color="muted">{label}</Caption>
          </View>
        </Pressable>
      </View>
      {open ? (
        <AnchoredPopup
          anchor={anchor}
          onClose={() => setOpen(false)}
          testID={testID ? `${testID}-pop` : undefined}>
          <PopupHead>{i18n._(msg`Tags`)}</PopupHead>
          {tags.map(tag => (
            <PopupRow
              key={tag}
              testID={testID ? `${testID}-tag-${tag}` : undefined}
              label={`#${tag}`}
              onPress={() => select(tag)}
            />
          ))}
        </AnchoredPopup>
      ) : null}
    </>
  )
}
