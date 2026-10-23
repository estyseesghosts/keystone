// One article's discussions (`/news/discussions` + params): every post
// referencing the link, through the shared `search|<url>` feed — both
// families match URL text via `search.posts`, so no new backend member.
// The article itself opens externally from the news row; this screen is
// the conversation about it. The link title (when the row had one) rides
// as the feed's scroll header.

import {View} from 'react-native'
import {useRoute, type RouteProp} from '@react-navigation/native'

import {safeHttpUrl, type FeedDescriptor} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import type {RootParamList} from '#/routes'
import {FeedView, useActiveBackend} from '#/screens/HomeFeed'

export function NewsDiscussionsScreen() {
  const route = useRoute<RouteProp<RootParamList, 'NewsDiscussions'>>()
  const {session, backend} = useActiveBackend()
  const url = safeHttpUrl(route.params?.url ?? '')
  const title = route.params?.title

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="news-discussions-screen">
        <Pagehead title="Discussions" />
        <Body>Sign in to see the discussion.</Body>
        <Caption color="faint">Discussions never show sample data when signed out.</Caption>
        <SignInButton />
      </View>
    )
  }

  if (!url) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="news-discussions-screen">
        <Pagehead title="Discussions" />
        <Body>This link is not available.</Body>
      </View>
    )
  }

  const descriptor = `search|${url}` as FeedDescriptor
  return (
    <View style={atoms.flex1} testID="news-discussions-screen">
      <Pagehead title="Discussions" />
      <FeedView
        sessionId={session.id}
        descriptor={descriptor}
        testID="news-discussions-feed"
        scrollHeader={
          title ? (
            <View style={[atoms.px_md, atoms.py_sm]} testID="news-discussions-title">
              <Caption color="faint">{title}</Caption>
            </View>
          ) : undefined
        }
      />
    </View>
  )
}
