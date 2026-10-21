import {useEffect, useState} from 'react'
import {KeyboardAvoidingView, Platform, StyleSheet, View, type ViewStyle} from 'react-native'
import {
  CommonActions,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native'

import type {Post} from '@keystone/fedi'

import {useTheme as useAlfTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {useShellLayout} from '#/alf/breakpoints'
import {Body} from '#/alf/typography'
import {Button} from '#/components/Button'
import {CompactComposer} from '#/components/Composer/CompactComposer'
import {Loader} from '#/components/Loader'
import {Pressable} from '#/components/Pressable'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'
import {appStorage} from '#/storage'

// Compose route (slice 4.3): floating overlay over the current screen
// (v1 `.postbox-overlay`): dimmed backdrop (tap = close) + centered card.
// Mobile goes full-bleed like the reference client; wider shells get the
// 600px card. Resolves reply/quote targets through the ACTIVE session's
// backend. Params: replyToId, quoteId, draftId.
export function ComposeScreen() {
  const route = useRoute<RouteProp<RootParamList, 'Compose'>>()
  const nav = useNavigation()
  const layout = useShellLayout()
  const alf = useAlfTheme()
  const {session, backend} = useActiveBackend()
  const {replyToId, quoteId, draftId} = route.params ?? {}
  const [targets, setTargets] = useState<{replyTo: Post | null; quote: Post | null} | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const close = () => {
    if (nav.canGoBack()) nav.goBack()
    else nav.dispatch(CommonActions.reset({index: 0, routes: [{name: 'Main'}]}))
  }

  const shell = (content: React.ReactNode) => (
    <View style={styles.overlay} testID="compose-overlay">
      <Pressable
        style={styles.backdrop}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel="Close composer"
        testID="compose-backdrop"
      />
      <View pointerEvents="box-none" style={styles.cardWrap}>
        <View
          style={[
            styles.card,
            layout === 'mobile' ? styles.cardMobile : styles.cardFloat,
            {backgroundColor: alf.palette.bg, borderColor: alf.palette.edge},
          ]}>
          <KeyboardAvoidingView
            style={styles.kav}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={0}>
            {content}
          </KeyboardAvoidingView>
        </View>
      </View>
    </View>
  )

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

  if (!session || !backend) {
    return shell(
      <View style={[atoms.centered, atoms.p_md, atoms.gap_md]}>
        <Body>Sign in to post.</Body>
        <Button label="Close" variant="secondary" onPress={close} />
      </View>,
    )
  }
  if (failed) {
    return shell(
      <View style={[atoms.centered, atoms.p_md, atoms.gap_md]}>
        <Body>{failed}</Body>
        <Button label="Close" variant="secondary" onPress={close} />
      </View>,
    )
  }
  if (!targets) {
    return shell(
      <View style={[atoms.centered, atoms.p_md]}>
        <Loader />
      </View>,
    )
  }
  return shell(
    <CompactComposer
      // Remount when the account or target changes: state never carries across.
      key={`${session.id}|${replyToId ?? ''}|${quoteId ?? ''}|${draftId ?? ''}`}
      session={session}
      backend={backend}
      store={appStorage()}
      replyTo={targets.replyTo}
      quote={targets.quote}
      draftId={draftId ?? null}
      onClose={close}
    />,
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    ...Platform.select({
      web: {position: 'fixed', inset: 0, zIndex: 100} as unknown as ViewStyle,
      default: {},
    }),
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  cardWrap: {
    flex: 1,
    alignItems: 'center',
    ...Platform.select({
      web: {position: 'fixed', inset: 0, zIndex: 101, paddingTop: 48} as unknown as ViewStyle,
      default: {},
    }),
  },
  card: {
    width: '100%',
    maxWidth: 600,
    overflow: 'hidden',
  },
  kav: {
    flex: 1,
  },
  cardFloat: {
    maxHeight: '85%',
    borderWidth: 1,
    borderRadius: 16,
  },
  cardMobile: {
    flex: 1,
    marginTop: 0,
  },
})
