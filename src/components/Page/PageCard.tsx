// Page list card (P6.5 Pages, slice 2; reused by the index in slice 3):
// eye-catch thumbnail, title, summary truncated to 85 chars + `…`,
// author avatar + name. Taps open the reader.

import {StyleSheet, View} from 'react-native'

import type {PageModel} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {AppImage} from '#/components/Image'
import {Pressable} from '#/components/Pressable'
import {navigationRef} from '#/navigationRef'
import {i18n} from '#/locale/i18n'
import {msg} from '@lingui/macro'

const SUMMARY_LIMIT = 85

/** Card summary: first 85 chars + `…` (Misskey `MkPagePreview` parity). Pure. */
export function pageCardSummary(page: Pick<PageModel, 'title' | 'summary'>): string {
  const text = page.summary ?? page.title
  if (text.length <= SUMMARY_LIMIT) return text
  return `${text.slice(0, SUMMARY_LIMIT)}…`
}

const styles = StyleSheet.create({
  card: {flexDirection: 'row', gap: 12, paddingVertical: 12},
  thumb: {width: 112, height: 84, borderRadius: 8, overflow: 'hidden'},
  body: {flex: 1, gap: 4, justifyContent: 'center'},
  author: {flexDirection: 'row', alignItems: 'center', gap: 6},
  avatar: {width: 20, height: 20, borderRadius: 10},
})

export function PageCard({page, testID}: {page: PageModel; testID?: string}) {
  const open = () => {
    navigationRef.navigate('Page', {id: page.id})
  }
  return (
    <Pressable
      testID={testID ?? `page-card-${page.id}`}
      onPress={open}
      accessibilityRole="link"
      accessibilityLabel={i18n._(msg`Open page: ${page.title || page.name}`)}>
      <View style={styles.card}>
        {page.eyeCatchingImage?.url ? (
          <View style={styles.thumb}>
            <AppImage
              uri={page.eyeCatchingImage.url}
              blurhash={page.eyeCatchingImage.blurhash}
              contentFit="cover"
              alt={page.eyeCatchingImage.description ?? undefined}
              testID={testID ? `${testID}-thumb` : undefined}
              style={{width: '100%', height: '100%'}}
            />
          </View>
        ) : null}
        <View style={styles.body}>
          <Body numberOfLines={2}>{page.title || page.name}</Body>
          <Caption color="faint" numberOfLines={2}>
            {pageCardSummary(page)}
          </Caption>
          <View style={styles.author}>
            <AppImage
              uri={page.author.avatarUrl}
              contentFit="cover"
              alt={page.author.displayName}
              style={styles.avatar}
            />
            <Caption color="faint" numberOfLines={1}>
              {page.author.displayName}
            </Caption>
          </View>
        </View>
      </View>
    </Pressable>
  )
}
