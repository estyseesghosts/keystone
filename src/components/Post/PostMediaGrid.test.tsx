import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'
import {StyleSheet} from 'react-native'
import type {Media} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {PostMediaGrid, displayAspect, isOutOfRange, tileAspect, MAX_DISPLAY_H} from './PostMediaGrid'

i18n.load('en', {})
i18n.activate('en')

/** expo-image element for a Still tile: the testID is forwarded to
 * wrapper views (Lightbox precedent), so prop assertions pick the match
 * that owns the `source` key (including placeholder-only `null`), falling
 * back to a styled match. */
function sourcedByTestId(testID: string): any {
  const all = screen.UNSAFE_queryAllByProps({testID} as never) as unknown as Array<any>
  const found =
    all.find(el => el.props != null && 'source' in el.props) ??
    all.find(el => el.props?.style !== undefined)
  if (!found) throw new Error(`no sourced element for ${testID} (${all.length} matches)`)
  return found
}

/** All host elements carrying an accessibility label (expo-image forwards
 * labels to wrappers, and label-less TileFrames reuse the tile label, so
 * `getByLabelText` can match more than one — count instead). */
function labelled(label: string): Array<any> {
  return screen.UNSAFE_queryAllByProps({accessibilityLabel: label} as never) as unknown as Array<any>
}

function stillImg(id: string): any {
  return sourcedByTestId(`media-still-${id}`)
}

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

  it('clamps strip ratios to the display range (no 2200px panoramas)', () => {
    expect(tileAspect(imageMedia(), false)).toBe(4 / 3)
    expect(tileAspect(metaMedia(3000, 1000), false)).toBe(2)
    expect(tileAspect(metaMedia(100, 1000), false)).toBe(0.75)
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
    expect(stillImg('m1').props.contentFit).toBe('contain')
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
    expect(stillImg('m1').props.contentFit).toBe('cover')
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
    expect(stillImg('m1').props.contentFit).toBe('cover')
    expect(stillImg('m2').props.contentFit).toBe('cover')
  })

  it('prefers the preview URL and holds the blurhash placeholder', () => {
    renderWithProviders(
      <PostMediaGrid
        media={[
          imageMedia({
            id: 'm1',
            description: 'Previewed',
            url: 'https://cdn.example/full.png',
            previewUrl: 'https://cdn.example/thumb.png',
            blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
          }),
        ]}
        testID="grid"
      />,
    )
    // The 220px tile decodes the thumbnail, never the multi-MB original.
    expect(stillImg('m1').props.source).toEqual({uri: 'https://cdn.example/thumb.png'})
    expect(stillImg('m1').props.placeholder).toEqual({blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'})
    expect(stillImg('m1').props.recyclingKey).toBe('m1')
  })

  it('falls back to the generated alt text, never the bare kind', () => {
    renderWithProviders(
      <PostMediaGrid
        media={[imageMedia({id: 'm1', description: null, name: ''})]}
        onOpen={() => {}}
        testID="grid"
      />,
    )
    expect(screen.getByLabelText('Image attachment 1')).toBeTruthy()
  })

  it('re-fits a meta-less frame once expo-image reports the decoded size', () => {
    renderWithProviders(
      <PostMediaGrid media={[imageMedia({id: 'm1', description: 'Tall'})]} testID="grid" />,
    )
    expect(stillImg('m1').props.contentFit).toBe('contain')
    fireEvent(stillImg('m1'), 'onLoad', {
      source: {url: 'https://cdn.example/i1.png', width: 3000, height: 1000, mediaType: 'image/png'},
    })
    // A 3:1 panorama is outside the display range: it crops to the box.
    expect(stillImg('m1').props.contentFit).toBe('cover')
  })

  it('tolerates a load event with no size (test-renderer bare fire)', () => {
    renderWithProviders(
      <PostMediaGrid media={[imageMedia({id: 'm1', description: 'Tall'})]} testID="grid" />,
    )
    expect(() => fireEvent(stillImg('m1'), 'onLoad')).not.toThrow()
    expect(stillImg('m1').props.contentFit).toBe('contain')
  })

  it('renders nothing without media', () => {
    const {toJSON} = renderWithProviders(<PostMediaGrid media={[]} testID="grid" />)
    expect(toJSON()).toBeNull()
  })

  it('keeps per-tile sensitive gates keyed by media id', () => {
    const onOpen = jest.fn()
    renderWithProviders(
      <PostMediaGrid
        media={[imageMedia({id: 'm1', isSensitive: true, description: 'Sneaky'})]}
        onOpen={onOpen}
        testID="grid"
      />,
    )
    // The hidden tile reserves its frame with a blurhash cover (never a
    // blank box) and an explicit Show control — never the bare tile.
    expect(screen.getByTestId('media-sensitive-cover-m1')).toBeTruthy()
    expect(screen.queryByLabelText('Sneaky')).toBeNull()
    fireEvent.press(screen.getByTestId('media-sensitive-show-m1'))
    expect(screen.getByLabelText('Sneaky')).toBeTruthy()
  })

  it('reveals only the tapped tile and re-hides on Hide', () => {
    renderWithProviders(
      <PostMediaGrid
        media={[
          imageMedia({id: 's1', isSensitive: true, description: 'First'}),
          imageMedia({id: 's2', isSensitive: true, description: 'Second'}),
        ]}
        testID="grid"
      />,
    )
    fireEvent.press(screen.getByTestId('media-sensitive-show-s1'))
    expect(labelled('First').length).toBeGreaterThan(0)
    // The second tile stays behind its own gate (id-keyed, not indexed).
    expect(screen.queryByLabelText('Second')).toBeNull()
    expect(screen.getByTestId('media-sensitive-show-s2')).toBeTruthy()
    // Re-hide returns the first tile behind its cover.
    fireEvent.press(screen.getByTestId('media-sensitive-hide-s1'))
    expect(screen.queryByLabelText('First')).toBeNull()
    expect(screen.getByTestId('media-sensitive-show-s1')).toBeTruthy()
  })

  it('covers sensitive tiles with the blurhash and fetches nothing', () => {
    renderWithProviders(
      <PostMediaGrid
        media={[
          imageMedia({
            id: 's1',
            isSensitive: true,
            description: 'Hidden',
            blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
          }),
        ]}
        testID="grid"
      />,
    )
    // Placeholder-only: no source URI, so no sensitive bytes load.
    const blur = sourcedByTestId('media-sensitive-blur-s1')
    expect(blur.props.source).toBeNull()
    expect(blur.props.placeholder).toEqual({blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'})
    fireEvent.press(screen.getByTestId('media-sensitive-show-s1'))
    expect(labelled('Hidden').length).toBeGreaterThan(0)
  })

  it('missing URLs render the honest placeholder, never a fetch', () => {
    renderWithProviders(
      <PostMediaGrid media={[imageMedia({id: 'm1', url: 'notaurl'})]} testID="grid" />,
    )
    expect(screen.getByTestId('media-missing-m1')).toBeTruthy()
  })

  it('shrink-wraps the single-tile pressable to the image box (no full-row dead zone)', () => {
    renderWithProviders(
      <PostMediaGrid
        media={[metaMedia(300, 400, {id: 'm1', description: 'Tall'})]}
        onOpen={() => {}}
        testID="grid"
      />,
    )
    // A 3:4 portrait hugs at 480 × aspect; the button must hug with it
    // instead of stretching the full row width beside the image.
    const flat = StyleSheet.flatten(screen.getByLabelText('Open media: Tall').props.style) as {
      alignSelf?: string
      maxWidth?: string | number
    }
    expect(flat.alignSelf).toBe('flex-start')
    expect(flat.maxWidth).toBe('100%')
  })

  it('shrink-wraps strip tile pressables too (same TileFrame)', () => {
    renderWithProviders(
      <PostMediaGrid
        media={[imageMedia({id: 'm1', description: 'One'}), imageMedia({id: 'm2', description: 'Two'})]}
        onOpen={() => {}}
        testID="grid"
      />,
    )
    for (const label of ['Open media: One', 'Open media: Two']) {
      const flat = StyleSheet.flatten(screen.getByLabelText(label).props.style) as {
        alignSelf?: string
      }
      expect(flat.alignSelf).toBe('flex-start')
    }
  })
})
