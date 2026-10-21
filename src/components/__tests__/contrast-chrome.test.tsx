// Stream B contrast-sweep regressions: every fixed chrome pairing must
// contrast in BOTH themes (light + dark render, assert themed colors).

import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {render, screen} from '@testing-library/react-native'
import {StyleSheet} from 'react-native'
import type {Media, Notification} from '@keystone/fedi'

import {ThemeProvider, type ThemeName} from '#/alf/index'
import {overlayChrome, themes} from '#/alf/themes'
import {Button} from '#/components/Button'
import {Dialog} from '#/components/Dialog'
import {CustomEmojiGlyph, UnicodeEmoji} from '#/components/EmojiImage'
import {Lightbox} from '#/components/Lightbox'
import {NotificationRow} from '#/components/Notification/NotificationRow'

i18n.load('en', {})
i18n.activate('en')

const MODES: ThemeName[] = ['light', 'dark']

function renderWithProviders(ui: React.ReactElement, theme: ThemeName) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

function imageMedia(over: Partial<Media> = {}): Media {
  return {
    id: 'm1',
    kind: 'image',
    mimeType: 'image/png',
    url: 'notaurl',
    previewUrl: null,
    name: 'i1.png',
    description: 'Alt text here',
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

describe('contrast chrome (both themes)', () => {
  for (const mode of MODES) {
    it(`Dialog backdrop is the fixed dark scrim in ${mode}`, () => {
      const {unmount} = renderWithProviders(
        <Dialog testID="dlg" open onClose={() => {}} title="Title">
          <Button label="Inside" onPress={() => {}} />
        </Dialog>,
        mode,
      )
      expect(StyleSheet.flatten(screen.getByTestId('dlg-backdrop').props.style)?.backgroundColor).toBe(
        overlayChrome.backdrop,
      )
      unmount()
    })

    it(`Lightbox keeps near-white text on the black backdrop in ${mode}`, () => {
      const {unmount} = renderWithProviders(
        <Lightbox media={[imageMedia()]} index={0} onClose={() => {}} testID="lb" />,
        mode,
      )
      expect(StyleSheet.flatten(screen.getByTestId('lightbox-caption').props.style)?.backgroundColor).toBe(
        overlayChrome.captionScrim,
      )
      for (const node of screen.getAllByText('Alt text here')) {
        expect(StyleSheet.flatten(node.props.style)?.color).toBe(overlayChrome.fg)
      }
      expect(StyleSheet.flatten(screen.getByText('1 / 1').props.style)?.color).toBe(overlayChrome.fg)
      unmount()
    })

    it(`emoji fallbacks use themed text in ${mode}`, () => {
      const {unmount} = renderWithProviders(
        <>
          <UnicodeEmoji sequence="🦋" style="system" testID="uni" />
          <CustomEmojiGlyph name="wave" host={null} src={null} testID="custom" />
        </>,
        mode,
      )
      expect(StyleSheet.flatten(screen.getByTestId('uni').props.style)?.color).toBe(
        themes[mode].palette.text,
      )
      expect(StyleSheet.flatten(screen.getByTestId('custom').props.style)?.color).toBe(
        themes[mode].palette.text,
      )
      unmount()
    })

    it(`notification avatar fallback pairs themed text on bgSoft in ${mode}`, () => {
      const notification = {
        id: 'n1',
        kind: 'follow',
        rawType: 'follow',
        createdAt: new Date().toISOString(),
        read: false,
        actors: [{id: 'u9', account: null, reaction: null}],
        post: null,
        reaction: null,
        ext: {},
      } as unknown as Notification
      const {unmount} = renderWithProviders(<NotificationRow notification={notification} />, mode)
      const avatar = screen.getByTestId('notification-avatar-fallback-u9')
      expect(StyleSheet.flatten(avatar.props.style)?.backgroundColor).toBe(
        themes[mode].palette.bgSoft,
      )
      unmount()
    })

    it(`primary Button pairs inverted chrome in ${mode}`, () => {
      const {unmount} = renderWithProviders(<Button label="Save" onPress={() => {}} />, mode)
      const label = screen.getByText('Save')
      expect(StyleSheet.flatten(label.props.style)?.color).toBe(themes[mode].palette.bg)
      unmount()
    })
  }
})
