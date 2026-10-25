// X9.4 i18n (components + remaining screens): every user-visible string
// in the converted files flows through Lingui. These tests pin the
// English source strings render through the catalog path (I18nProvider +
// activated `en`), including the plural forms and the previously-mangled
// RecommendationReasonDialog layout.

import {I18nProvider} from '@lingui/react'
import {render, screen} from '@testing-library/react-native'
import React from 'react'

import type {RecommendationBreakdown} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {PostFeed} from '#/components/PostFeed/index'
import {RecommendationReasonDialog} from '#/components/Recommendations/RecommendationReasonDialog'
import {SkeletonList} from '#/components/Skeleton'
import {Placeholder} from '#/screens/Placeholder'
import {TagChip} from '#/screens/explore/rows'
import {buildPickerSections} from '#/components/EmojiPicker/model'
import {settingsMeta, settingsTitle} from '#/screens/settings/meta'
import {i18n as appI18n} from '#/locale/i18n'

appI18n.load('en', {})
appI18n.activate('en')

function renderChrome(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={appI18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

describe('X9.4 translated chrome', () => {
  it('PostFeed pill uses plural forms', () => {
    const {unmount} = renderChrome(
      <PostFeed sessionId="s" descriptor="timeline|home" posts={[]} hasNewPosts newPostsCount={1} />,
    )
    expect(screen.getByText('Show 1 new post')).toBeTruthy()
    unmount()
    const second = renderChrome(
      <PostFeed sessionId="s" descriptor="timeline|home" posts={[]} hasNewPosts newPostsCount={3} />,
    )
    expect(screen.getByText('Show 3 new posts')).toBeTruthy()
    second.unmount()
    const third = renderChrome(<PostFeed sessionId="s" descriptor="timeline|home" posts={[]} />)
    expect(screen.queryByText(/Show .* new posts?/)).toBeNull()
    third.unmount()
  })

  it('PostFeed error and empty states render translated', () => {
    const {unmount} = renderChrome(
      <PostFeed sessionId="s" descriptor="timeline|home" posts={[]} isError onRefresh={() => {}} />,
    )
    expect(screen.getByText("Couldn't load this feed")).toBeTruthy()
    expect(screen.getByText('Check your connection and try again.')).toBeTruthy()
    expect(screen.getByText('Retry')).toBeTruthy()
    unmount()
    const second = renderChrome(<PostFeed sessionId="s" descriptor="timeline|home" posts={[]} />)
    expect(screen.getByText('No posts yet')).toBeTruthy()
    second.unmount()
  })

  it('TagChip counts use plural forms', () => {
    const {unmount} = renderChrome(
      <TagChip tag={{name: 'cats', users: 1, uses: 1}} onOpen={() => {}} />,
    )
    expect(screen.getByText('1 person · 1 post')).toBeTruthy()
    unmount()
    const second = renderChrome(
      <TagChip tag={{name: 'cats', users: 5, uses: 2}} onOpen={() => {}} />,
    )
    expect(screen.getByText('5 people · 2 posts')).toBeTruthy()
    second.unmount()
  })

  it('SkeletonList and Placeholder render translated chrome', () => {
    const {unmount} = renderChrome(<SkeletonList variant="row" count={1} testID="sk" />)
    expect(screen.getByLabelText('Loading')).toBeTruthy()
    unmount()
    const second = renderChrome(<Placeholder title="Some screen" />)
    expect(screen.getByText('Some screen')).toBeTruthy()
    expect(second.getByText('Not built yet')).toBeTruthy()
    second.unmount()
  })

  it('settings meta titles and hints resolve in English', () => {
    expect(settingsTitle(appI18n, 'account')).toBe('Your account')
    expect(settingsTitle(appI18n, 'language')).toBe('Language')
    const meta = settingsMeta(appI18n)
    expect(meta).toHaveLength(9)
    expect(meta.find(s => s.id === 'mutes')).toEqual({
      id: 'mutes',
      title: 'Mutes and blocks',
      hint: 'Words, servers, accounts.',
    })
  })

  it('emoji picker section titles resolve in English', () => {
    const sections = buildPickerSections({
      custom: [],
      recents: [{kind: 'unicode', key: '🔥'}],
      query: '',
      favourites: [{kind: 'unicode', key: '👍'}],
    })
    expect(sections.map(s => s.title)).toEqual(
      expect.arrayContaining(['Recently used', 'Favourites']),
    )
    const remote = buildPickerSections({
      custom: [],
      recents: [],
      query: 'blob',
      remote: [{name: 'blobcat', host: 'a.example', url: 'https://a.example/b.png'}],
    })
    expect(remote.map(s => s.title)).toContain('Remote')
  })

  it('RecommendationReasonDialog renders translated rows (mangled layout fixed)', () => {
    const breakdown: RecommendationBreakdown = {
      type: 'score',
      score: 1.23456,
      subtotal: 1.1,
      topic: 'tech',
      rows: [{key: 'relevancy', kind: 'add', raw: 0.5, weight: 1, coeff: 1, effect: 0.5}],
      engagements: [{key: 'dwell', prob: 0.9, value: 1, effect: 0.2}],
    }
    const {unmount} = renderChrome(
      <RecommendationReasonDialog breakdown={breakdown} open onClose={() => {}} />,
    )
    expect(screen.getByText('Why is this post recommended?')).toBeTruthy()
    expect(screen.getByText('Final score: 1.235')).toBeTruthy()
    expect(screen.getByText('Inferred topic: tech')).toBeTruthy()
    expect(screen.getByText('Type: Score')).toBeTruthy()
    expect(screen.getByText('Subtotal')).toBeTruthy()
    expect(screen.getByText('Final score')).toBeTruthy()
    expect(screen.getByText('Good click')).toBeTruthy()
    unmount()
  })
})
