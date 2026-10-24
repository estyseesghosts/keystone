import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'
import type {Media} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {PostMediaGrid, displayAspect, isOutOfRange, tileAspect, MAX_DISPLAY_H} from './PostMediaGrid'

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

describe('displayAspect (docs/image-sizing.md range)', () => {
  it('passes the in-range ratios through untouched', () => {
    expect(displayAspect(2)).toBe(2)
    expect(displayAspect(0.75)).toBe(0.75)
    expect(displayAspect(16 / 10)).toBe(16 / 10)
    expect(displayAspect(1)).toBe(1)
    expect(displayAspect(4 / 3)).toBe(4 / 3)
  })

  it('clamps outside shapes to the range edges (crop only outside)', () => {
    expect(displayAspect(3)).toBe(2)
    expect(displayAspect(5)).toBe(2)
    expect(displayAspect(0.5)).toBe(0.75)
    expect(displayAspect(9 / 16)).toBe(0.75)
  })

  it('falls back to the neutral landscape default on garbage', () => {
    expect(displayAspect(NaN)).toBe(16 / 10)
    expect(displayAspect(Infinity)).toBe(16 / 10)
    expect(displayAspect(0)).toBe(16 / 10)
    expect(displayAspect(-1)).toBe(16 / 10)
  })
})

describe('tileAspect', () => {
  it('clamps single meta ratios, keeps in-range full', () => {
    expect(tileAspect(metaMedia(1600, 900), true)).toBe(16 / 9)
    expect(tileAspect(metaMedia(300, 400), true)).toBe(0.75)
    expect(tileAspect(metaMedia(3000, 1000), true)).toBe(2)
    expect(tileAspect(metaMedia(100, 300), true)).toBe(0.75)
  })

  it('bounds single height absolutely (wide-column portraits)', () => {
    expect(MAX_DISPLAY_H).toBe(480)
  })

  it('flags only outside ratios for cropping', () => {
    expect(isOutOfRange(2)).toBe(false)
    expect(isOutOfRange(0.75)).toBe(false)
    expect(isOutOfRange(1)).toBe(false)
    expect(isOutOfRange(3)).toBe(true)
    expect(isOutOfRange(0.5)).toBe(true)
    expect(isOutOfRange(NaN)).toBe(false)
    expect(isOutOfRange(0)).toBe(false)
  })

  it('defaults a metadata-less single to 16:10', () => {
    expect(tileAspect(imageMedia(), true)).toBe(16 / 10)
  })

  it('leaves the multi strip layout alone (no clamp)', () => {
    expect(tileAspect(imageMedia(), false)).toBe(4 / 3)
    expect(tileAspect(metaMedia(3000, 1000), false)).toBe(3)
  })
})

describe('PostMediaGrid sizing', () => {
  it('renders one tile per attachment with alt text; taps open by index', () => {
    const onOpen = jest.fn()
    renderWithProviders(
      <PostMediaGrid
        media={[
          imageMedia({id: 'm1', description: 'A cat'}),
          imageMedia({id: 'm2', name: 'beach.jpg'}),
        ]}
        onOpen={onOpen}
        testID="grid"
      />,
    )
    expect(screen.getByLabelText('A cat')).toBeTruthy()
    fireEvent.press(screen.getByLabelText('Open media: A cat'))
    expect(onOpen).toHaveBeenCalledWith(0)
  })

  it('fits single stills (contain — scale down, never crop)', () => {
    const onOpen = jest.fn()
    renderWithProviders(
      <PostMediaGrid
        media={[imageMedia({id: 'm1', description: 'Tall'})]}
        onOpen={onOpen}
        testID="grid"
      />,
    )
    expect(screen.getByLabelText('Tall').props.resizeMode).toBe('contain')
  })

  it('crops ONLY outside singles (cover to the clamped box)', () => {
    const onOpen = jest.fn()
    renderWithProviders(
      <PostMediaGrid
        media={[metaMedia(3000, 1000, {id: 'm1', description: 'Pano'})]}
        onOpen={onOpen}
        testID="grid"
      />,
    )
    expect(screen.getByLabelText('Pano').props.resizeMode).toBe('cover')
  })

  it('keeps the uniform cover crop on strip tiles', () => {
    const onOpen = jest.fn()
    renderWithProviders(
      <PostMediaGrid
        media={[imageMedia({id: 'm1', description: 'One'}), imageMedia({id: 'm2', description: 'Two'})]}
        onOpen={onOpen}
        testID="grid"
      />,
    )
    expect(screen.getByLabelText('One').props.resizeMode).toBe('cover')
    expect(screen.getByLabelText('Two').props.resizeMode).toBe('cover')
  })

  it('renders nothing without media', () => {
    const {toJSON} = renderWithProviders(<PostMediaGrid media={[]} testID="grid" />)
    expect(toJSON()).toBeNull()
  })

  it('keeps per-tile sensitive gates', () => {
    const onOpen = jest.fn()
    renderWithProviders(
      <PostMediaGrid
        media={[imageMedia({id: 'm1', isSensitive: true, description: 'Sneaky'})]}
        onOpen={onOpen}
        testID="grid"
      />,
    )
    expect(screen.getByTestId('media-sensitive-show')).toBeTruthy()
    fireEvent.press(screen.getByTestId('media-sensitive-show'))
    expect(screen.getByLabelText('Sneaky')).toBeTruthy()
  })

  it('missing URLs render the honest placeholder, never a fetch', () => {
    renderWithProviders(
      <PostMediaGrid media={[imageMedia({id: 'm1', url: 'notaurl'})]} testID="grid" />,
    )
    expect(screen.getByTestId('media-missing-m1')).toBeTruthy()
  })
})
