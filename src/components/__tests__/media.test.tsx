import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'
import {useState} from 'react'
import {StyleSheet} from 'react-native'
import type {Media} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {overlayChrome} from '#/alf/themes'
import {Lightbox} from '#/components/Lightbox'
import {mediaAlt} from '#/lib/mediaAlt'

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

  it('trims the description and falls back on blank', () => {
    expect(mediaAlt(imageMedia({description: '  A cat  '}), 0)).toBe('A cat')
    expect(mediaAlt(imageMedia({description: '   '}), 2)).toContain('Image attachment 3')
  })

  it('names the kind, position, and file for every attachment kind', () => {
    expect(mediaAlt(imageMedia({kind: 'video', name: 'clip.mp4'}), 1)).toBe('Video attachment 2: clip.mp4')
    expect(mediaAlt(imageMedia({kind: 'gifv', name: ''}), 0)).toBe('Video attachment 1')
    expect(mediaAlt(imageMedia({kind: 'audio', name: 'song.mp3'}), 0)).toBe('Audio attachment 1: song.mp3')
    expect(mediaAlt(imageMedia({kind: 'file', name: 'doc.pdf'}), 3)).toBe('File attachment 4: doc.pdf')
    expect(mediaAlt(imageMedia({kind: 'image', name: ''}), 0)).toBe('Image attachment 1')
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
      expect(StyleSheet.flatten(node.props.style)?.color).toBe(overlayChrome.fg)
    }
    expect(StyleSheet.flatten(screen.getByText('1 / 1').props.style)?.color).toBe(overlayChrome.fg)
  })
})
