// P6.5 Pages slice 4: DrivePicker — drive gate, browse pick, upload tab.

import {fireEvent, render, screen} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'

import {i18n} from '#/locale/i18n'
import {ThemeProvider} from '#/alf/index'

import {DrivePicker} from './DrivePicker'
import type {Media} from '@keystone/fedi'

i18n.load('en', {})
i18n.activate('en')

function media(over: Partial<Media> = {}): Media {
  return {
    id: 'f1',
    kind: 'image',
    mimeType: 'image/png',
    url: 'https://a.example/f1.png',
    previewUrl: null,
    name: 'f1.png',
    description: null,
    blurhash: null,
    isSensitive: false,
    size: 100,
    md5: null,
    meta: null,
    createdAt: null,
    folderId: null,
    userId: 'alice',
    ...over,
  }
}

function renderPicker(backend: unknown, onPick: jest.Mock) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <DrivePicker backend={backend as never} onPick={onPick} testID="dp" />
      </ThemeProvider>
    </I18nProvider>,
  )
}

describe('DrivePicker', () => {
  it('explains when drive is unsupported (no inert picker)', async () => {
    renderPicker({family: 'misskey', capabilities: {}}, jest.fn())
    expect(await screen.findByText('Drive is not available on this server.')).toBeTruthy()
  })

  it('lists image files and returns the pick', async () => {
    const onPick = jest.fn()
    const files = jest.fn(async () => ({items: [media()], cursor: null, end: true}))
    renderPicker({family: 'misskey', capabilities: {drive: 'supported'}, drive: {files}}, onPick)
    expect(await screen.findByTestId('dp-browse-file-f1')).toBeTruthy()
    fireEvent.press(screen.getByTestId('dp-browse-file-f1'))
    expect(onPick).toHaveBeenCalledWith(media())
  })

  it('filters out non-images and shows the empty state', async () => {
    renderPicker(
      {
        family: 'misskey',
        capabilities: {drive: 'supported'},
        drive: {files: jest.fn(async () => ({items: [media({id: 'v1', mimeType: 'video/mp4', name: 'v.mp4'})], cursor: null, end: true}))},
      },
      jest.fn(),
    )
    expect(await screen.findByText('No images here yet.')).toBeTruthy()
  })

  it('upload tab is reachable', async () => {
    renderPicker(
      {
        family: 'misskey',
        capabilities: {drive: 'supported'},
        drive: {files: jest.fn(async () => ({items: [], cursor: null, end: true}))},
      },
      jest.fn(),
    )
    fireEvent.press(await screen.findByTestId('dp-tab-upload'))
    expect(await screen.findByTestId('dp-upload-choose')).toBeTruthy()
  })
})
