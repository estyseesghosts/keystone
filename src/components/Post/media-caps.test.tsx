// polish/8-media-caps: single still images and link preview cards hug at
// most 520 wide on wide columns (`mediaPx.singleMaxW`) while shrinking on
// narrow viewports (`maxWidth`/`width: 100%`). Video, gifv, strips, and
// quote-bleed media keep their existing sizing (pure-unit pins — video
// tiles never render in Jest with expo-video unmocked).
import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {render, screen} from '@testing-library/react-native'
import {StyleSheet} from 'react-native'
import type {Media} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {mediaPx} from '#/alf/tokens'
import type {LinkCard as LinkCardModel} from '@keystone/fedi'

import {LinkCard, UnfurledLinkCard} from './LinkCard'
import {PostMediaGrid, singleFrameWidth} from './PostMediaGrid'

i18n.load('en', {})
i18n.activate('en')

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

function imageMedia(over: Partial<Media> = {}): Media {
  return {
    id: 'm1',
    kind: 'image',
    mimeType: 'image/png',
    url: 'https://cdn.example/i1.png',
    previewUrl: null,
    name: 'i1.png',
    description: null,
    blurhash: null,
    isSensitive: false,
    size: 10,
    md5: null,
    meta: null,
    createdAt: null,
    folderId: null,
    userId: null,
    ...over,
  } as Media
}

function metaMedia(width: number, height: number, over: Partial<Media> = {}): Media {
  return imageMedia({meta: {width, height}, ...over})
}

function card(over: Partial<LinkCardModel> = {}): LinkCardModel {
  return {
    url: 'https://example.com/article',
    title: 'An article',
    description: 'Read all about it.',
    image: 'https://example.com/cover.png',
    type: 'link',
    authorName: null,
    authorUrl: null,
    providerName: null,
    ...over,
  }
}

function flatStyle(testID: string): Record<string, unknown> {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style) as Record<string, unknown>
}

describe('singleFrameWidth (pure)', () => {
  it('caps wide single stills at the media cap', () => {
    expect(mediaPx.singleMaxW).toBe(520)
    // 16:10 would hug at 768 (480 × 1.6) — capped instead.
    expect(singleFrameWidth('image', 16 / 10, false)).toBe(520)
  })

  it('leaves narrow singles at their height-cap width', () => {
    // 3:4 portrait hugs at 360 — under the cap, untouched.
    expect(singleFrameWidth('image', 3 / 4, false)).toBe(480 * (3 / 4))
  })

  it('never caps video, gifv, or quote-bleed singles', () => {
    expect(singleFrameWidth('video', 16 / 9, false)).toBe(480 * (16 / 9))
    expect(singleFrameWidth('gifv', 16 / 10, false)).toBe(480 * (16 / 10))
    expect(singleFrameWidth('image', 16 / 10, true)).toBe(480 * (16 / 10))
  })
})

describe('single still frame (rendered)', () => {
  it('hugs the cap with the aspect intact and shrinks on narrow viewports', () => {
    renderWithProviders(
      <PostMediaGrid media={[metaMedia(1600, 1000, {id: 'm1'})]} onOpen={() => {}} testID="grid" />,
    )
    const frame = flatStyle('media-frame-m1')
    expect(frame.width).toBe(520)
    expect(frame.maxWidth).toBe('100%')
    expect(frame.aspectRatio).toBeCloseTo(16 / 10, 5)
  })

  it('keeps contain fit for the capped in-range still', () => {
    renderWithProviders(
      <PostMediaGrid media={[metaMedia(1600, 1000, {id: 'm1'})]} onOpen={() => {}} testID="grid" />,
    )
    const all = screen.UNSAFE_queryAllByProps({testID: 'media-still-m1'} as never) as Array<{
      props?: {contentFit?: unknown}
    }>
    const still = all.find(el => el.props != null && 'contentFit' in el.props)
    expect(still?.props?.contentFit).toBe('contain')
  })

  it('leaves portrait singles at their natural hug width', () => {
    renderWithProviders(
      <PostMediaGrid media={[metaMedia(300, 400, {id: 'm1'})]} onOpen={() => {}} testID="grid" />,
    )
    const frame = flatStyle('media-frame-m1')
    expect(frame.width).toBe(480 * (3 / 4))
    expect(frame.maxWidth).toBe('100%')
  })

  it('leaves multi-image strips uncapped', () => {
    renderWithProviders(
      <PostMediaGrid
        media={[metaMedia(1600, 1000, {id: 'm1'}), metaMedia(1600, 1000, {id: 'm2'})]}
        onOpen={() => {}}
        testID="grid"
      />,
    )
    for (const id of ['media-frame-m1', 'media-frame-m2']) {
      const frame = flatStyle(id)
      expect(frame.height).toBe(220)
      expect(frame.width).toBeUndefined()
      expect(frame.maxWidth).toBeUndefined()
    }
  })
})

describe('link preview caps (rendered)', () => {
  it('caps the server card while staying fluid', () => {
    renderWithProviders(<LinkCard card={card()} testID="lc" />)
    const outer = flatStyle('lc')
    expect(outer.maxWidth).toBe(520)
    expect(outer.width).toBe('100%')
    // Card chrome itself unchanged.
    const inner = flatStyle('lc-card')
    expect(inner.borderRadius).toBe(10)
  })

  it('caps the unfurled card while staying fluid', () => {
    renderWithProviders(
      <UnfurledLinkCard url="https://example.com/article" fetchPreview={async () => null} testID="uf" />,
    )
    const outer = flatStyle('uf')
    expect(outer.maxWidth).toBe(520)
    expect(outer.width).toBe('100%')
  })
})
