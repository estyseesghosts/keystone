// One hashtag's timeline (`/tags/:tag`): the `tag|<tag>` feed through
// the shared FeedView — the same empty/loading/error honesty as every
// other feed, never faked rows. Hashtag taps elsewhere already link to
// `/tags/:tag`; this screen makes them resolve.
//
// The action block above the feed is the clickstone §1.4 curation surface:
// Follow/Unfollow (both MastoAPI flavors), Feature/Don't feature (vanilla
// Mastodon only) and an honest disabled row for the hashtag MUTE that
// neither server has — no endpoint exists, so nothing is invented. Every
// control is state-aware and disabled WITH a reason; a 404 from the tag
// endpoint downgrades the row instead of erroring the screen.

import {useCallback, useEffect, useState} from 'react'
import {View} from 'react-native'
import {useRoute, type RouteProp} from '@react-navigation/native'
import {msg} from '@lingui/macro'
import {useI18n} from '#/locale/i18n'

import {
  isPermissionError,
  isUnsupportedError,
  type Backend,
  type FeedDescriptor,
  type TagInfo,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import {titleForRoute, type RootParamList} from '#/routes'
import {FeedView, useActiveBackend} from '#/screens/HomeFeed'
import {safeDescriptorArg} from './explore/safeDescriptor'

function DisabledAction({
  label,
  reason,
  testID,
}: {
  label: string
  reason: string
  testID: string
}) {
  return (
    <View style={[atoms.gap_sm]} testID={`${testID}-row`}>
      <Button label={label} onPress={() => {}} disabled disabledReason={reason} testID={testID} />
      <Caption color="faint">{reason}</Caption>
    </View>
  )
}

function TagActions({backend, tag}: {backend: Backend; tag: string}) {
  const tags = backend.tags
  const i18n = useI18n()
  const [info, setInfo] = useState<TagInfo | null>(null)
  const [loading, setLoading] = useState(true)
  /** A stable reason when the server cannot answer at all (404/405 or no
   * module) — the controls render disabled instead of disappearing. */
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const show = tags?.show

  const load = useCallback(async () => {
    if (!show) {
      setLoading(false)
      setUnavailable(i18n._(msg`This server cannot report hashtag state.`))
      setInfo(null)
      return
    }
    setLoading(true)
    setError(null)
    setUnavailable(null)
    try {
      setInfo(await show(tag))
    } catch (err) {
      if (isUnsupportedError(err)) {
        setUnavailable(i18n._(msg`This server has no state for this hashtag yet.`))
        setInfo(null)
      } else {
        setError(err instanceof Error ? err.message : i18n._(msg`Could not load this hashtag.`))
      }
    } finally {
      setLoading(false)
    }
  }, [show, tag, i18n])

  useEffect(() => {
    void load()
  }, [load])

  /** Run one action, then RE-READ the server state (never trust a local
   * guess): the labels below follow what the server now reports. */
  const act = async (run: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await run()
      await load()
    } catch (err) {
      if (isUnsupportedError(err)) {
        setUnavailable(i18n._(msg`This server does not support that hashtag action.`))
        setInfo(null)
      } else if (isPermissionError(err)) {
        setError(i18n._(msg`Your account cannot change this hashtag.`))
      } else {
        setError(err instanceof Error ? err.message : i18n._(msg`Action failed.`))
      }
    } finally {
      setBusy(false)
    }
  }

  if (!tags) {
    return (
      <View style={[atoms.gap_sm, atoms.px_md, atoms.py_sm]} testID="tag-actions">
        <DisabledAction
          label={i18n._(msg`Follow hashtag`)}
          reason={i18n._(msg`Hashtag following needs a Mastodon-family server.`)}
          testID="tag-follow"
        />
        <DisabledAction
          label={i18n._(msg`Mute this hashtag`)}
          reason={i18n._(msg`There is no hashtag-mute endpoint on this server; use a keyword filter instead.`)}
          testID="tag-mute"
        />
      </View>
    )
  }

  const following = info?.following === true
  const featuring = info?.featuring === true
  const followDisabled = busy || loading || unavailable !== null
  const followReason =
    unavailable ?? (loading ? i18n._(msg`Loading hashtag state…`) : undefined)

  return (
    <View style={[atoms.gap_sm, atoms.px_md, atoms.py_sm]} testID="tag-actions">
      {followDisabled && followReason ? (
        <DisabledAction
          label={following ? i18n._(msg`Unfollow hashtag`) : i18n._(msg`Follow hashtag`)}
          reason={followReason}
          testID="tag-follow"
        />
      ) : (
        <Button
          label={following ? i18n._(msg`Unfollow hashtag`) : i18n._(msg`Follow hashtag`)}
          variant="primary"
          disabled={busy}
          onPress={() => void act(() => (following ? tags.unfollow(tag) : tags.follow(tag)))}
          testID="tag-follow"
        />
      )}
      {tags.feature ? (
        <Button
          label={featuring ? i18n._(msg`Don't feature on profile`) : i18n._(msg`Feature on profile`)}
          variant="secondary"
          disabled={busy || loading || unavailable !== null}
          disabledReason={followReason}
          onPress={() =>
            void act(() => (featuring ? tags.unfeature!(tag) : tags.feature!(tag)))
          }
          testID="tag-feature"
        />
      ) : (
        <DisabledAction
          label={featuring ? i18n._(msg`Don't feature on profile`) : i18n._(msg`Feature on profile`)}
          reason={i18n._(msg`Featured hashtags are not available on this server.`)}
          testID="tag-feature"
        />
      )}
      <DisabledAction
        label={i18n._(msg`Mute this hashtag`)}
        reason={i18n._(msg`There is no hashtag-mute endpoint on this server; use a keyword filter instead.`)}
        testID="tag-mute"
      />
      {error ? (
        <Caption testID="tag-actions-error" color="faint">
          {error}
        </Caption>
      ) : null}
    </View>
  )
}

export function TagScreen() {
  const route = useRoute<RouteProp<RootParamList, 'Tag'>>()
  // `|` is the descriptor segment separator — never content. The shared
  // sanitizer keeps `tag|<tag>` to one segment (Explore's rule).
  const tag = safeDescriptorArg((route.params?.tag ?? '').replace(/^#+/, ''))
  const {session, backend} = useActiveBackend()
  const i18n = useI18n()
  const title = titleForRoute('Tag', {tag: route.params?.tag})
  if (!session || !backend) {
    return (
      <View style={atoms.flex1} testID="tag-screen">
        <Pagehead title={title} />
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Body>{i18n._(msg`Sign in to browse this tag.`)}</Body>
          <SignInButton />
        </View>
      </View>
    )
  }
  if (!tag) {
    return (
      <View style={atoms.flex1} testID="tag-screen">
        <Pagehead title={title} />
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Body>{i18n._(msg`This tag is empty.`)}</Body>
        </View>
      </View>
    )
  }
  return (
    <View style={atoms.flex1} testID="tag-screen">
      <Pagehead title={title} />
      <TagActions backend={backend} tag={tag} />
      <FeedView sessionId={session.id} descriptor={`tag|${tag}` as FeedDescriptor} testID="tag-feed" />
    </View>
  )
}
