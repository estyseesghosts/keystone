import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'
import {useState} from 'react'
import {StyleSheet} from 'react-native'
import type {Media} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {Lightbox} from '#/components/Lightbox'
import {MediaGrid, mediaAlt} from '#/components/MediaGrid'

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

describe('mediaAlt', () => {
  it('prefers the description, else a generated label', () => {
    expect(mediaAlt(imageMedia({description: 'A cat'}), 0)).toBe('A cat')
    expect(mediaAlt(imageMedia({description: null}), 0)).toContain('Image attachment 1')
  })
})

describe('MediaGrid', () => {
  it('renders nothing without media', () => {
    const {toJSON} = renderWithProviders(<MediaGrid media={[]} testID="grid" />)
    expect(toJSON()).toBeNull()
  })

  it('every tile carries alt text; taps open by index', () => {
    const onOpen = jest.fn()
    const media = [
      imageMedia({id: 'm1', description: 'A cat on a sofa'}),
      imageMedia({id: 'm2', description: null, name: 'beach.jpg'}),
    ]
    renderWithProviders(<MediaGrid media={media} onOpen={onOpen} testID="grid" />)
    expect(screen.getByLabelText('A cat on a sofa')).toBeTruthy()
    expect(screen.getByLabelText('Image attachment 2: beach.jpg')).toBeTruthy()
    fireEvent.press(screen.getByLabelText('Open media: A cat on a sofa'))
    expect(onOpen).toHaveBeenCalledWith(0)
  })

  it('sensitive media hides behind a reveal veil', () => {
    const onOpen = jest.fn()
    const media = [imageMedia({isSensitive: true, description: 'Sneaky'})]
    renderWithProviders(<MediaGrid media={media} sensitive onOpen={onOpen} testID="grid" />)
    expect(screen.getByTestId('media-sensitive-veil')).toBeTruthy()
    expect(screen.queryByLabelText('Sneaky')).toBeNull()
    fireEvent.press(screen.getByTestId('media-reveal'))
    expect(screen.getByLabelText('Sneaky')).toBeTruthy()
  })

  it('video tiles are labelled and still openable', () => {
    const onOpen = jest.fn()
    const media = [
      imageMedia({
        id: 'v1',
        kind: 'video',
        mimeType: 'video/mp4',
        url: 'https://cdn.example/v1.mp4',
        description: 'Launch clip',
      }),
    ]
    renderWithProviders(<MediaGrid media={media} onOpen={onOpen} />)
    expect(screen.getByLabelText('Launch clip')).toBeTruthy()
    fireEvent.press(screen.getByLabelText(/Open media: Launch clip/))
    expect(onOpen).toHaveBeenCalledWith(0)
  })
})

describe('Lightbox', () => {
  function Harness({media}: {media: Media[]}) {
    const [index, setIndex] = useState(0)
    const [open, setOpen] = useState(true)
    if (!open) return null
    return (
      <Lightbox
        media={media}
        index={index}
        onIndexChange={setIndex}
        onClose={() => setOpen(false)}
        testID="lb"
      />
    )
  }

  it('shows the counter, alt caption, and closes', () => {
    const media = [
      imageMedia({id: 'm1', description: 'First'}),
      imageMedia({id: 'm2', description: 'Second'}),
    ]
    renderWithProviders(<Harness media={media} />)
    expect(screen.getByText('1 / 2')).toBeTruthy()
    expect(screen.getByTestId('lightbox-caption')).toBeTruthy()
    fireEvent.press(screen.getByTestId('lightbox-close'))
    expect(screen.queryByTestId('lb')).toBeNull()
  })

  it('renders nothing without media', () => {
    const {toJSON} = renderWithProviders(
      <Lightbox media={[]} index={0} onClose={() => {}} />,
    )
    expect(toJSON()).toBeNull()
  })

  it('keeps captions near-white on the black backdrop in the light theme', () => {
    const media = [imageMedia({id: 'm9', url: 'notaurl', description: 'Unfetchable'})]
    renderWithProviders(<Harness media={media} />)
    // Both the frame fallback and the caption bar show the alt text —
    // neither may fall back to dark theme text on the black backdrop.
    const nodes = screen.getAllByText('Unfetchable')
    expect(nodes.length).toBeGreaterThanOrEqual(1)
    for (const node of nodes) {
      expect(StyleSheet.flatten(node.props.style)?.color).toBe('#fff')
    }
    expect(StyleSheet.flatten(screen.getByText('1 / 1').props.style)?.color).toBe('#fff')
  })
})
