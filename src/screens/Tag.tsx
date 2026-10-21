// One hashtag's timeline (`/tags/:tag`): the `tag|<tag>` feed through
// the shared FeedView — the same empty/loading/error honesty as every
// other feed, never faked rows. Hashtag taps elsewhere already link to
// `/tags/:tag`; this screen makes them resolve.

import {View} from 'react-native'
import {useRoute, type RouteProp} from '@react-navigation/native'

import type {FeedDescriptor} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body} from '#/alf/typography'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import {titleForRoute, type RootParamList} from '#/routes'
import {FeedView, useActiveBackend} from '#/screens/HomeFeed'

export function TagScreen() {
  const route = useRoute<RouteProp<RootParamList, 'Tag'>>()
  const tag = (route.params?.tag ?? '').replace(/^#+/, '')
  const {session, backend} = useActiveBackend()
  const title = titleForRoute('Tag', {tag: route.params?.tag})
  if (!session || !backend) {
    return (
      <View style={atoms.flex1} testID="tag-screen">
        <Pagehead title={title} />
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Body>Sign in to browse this tag.</Body>
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
          <Body>This tag is empty.</Body>
        </View>
      </View>
    )
  }
  return (
    <View style={atoms.flex1} testID="tag-screen">
      <Pagehead title={title} />
      <FeedView sessionId={session.id} descriptor={`tag|${tag}` as FeedDescriptor} testID="tag-feed" />
    </View>
  )
}
