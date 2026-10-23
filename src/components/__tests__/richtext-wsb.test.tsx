// WS-B content rendering: MFM decorations, structural markers and the
// plain projection in the sole renderer.
import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen} from '@testing-library/react-native'
import {StyleSheet} from 'react-native'

import {contentFromHtml, contentFromMfm, fnNode, t} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {RichText} from '#/components/RichText'
import {appearanceStore} from '#/state/appearance'

i18n.load('en', {})
i18n.activate('en')

function renderRichText(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

function fontSizeOf(text: string): number | undefined {
  const flat = StyleSheet.flatten(screen.getByText(text).props.style) as
    | {fontSize?: number}
    | undefined
  return flat?.fontSize
}

describe('RichText MFM decorations (F14)', () => {
  it('scales x2/x3/x4', () => {
    renderRichText(<RichText nodes={contentFromMfm('$[x2 big]')} />)
    expect(fontSizeOf('big')).toBe(30)
    renderRichText(<RichText nodes={contentFromMfm('$[x3 big]')} />)
    expect(fontSizeOf('big')).toBe(45)
    renderRichText(<RichText nodes={contentFromMfm('$[x4 big]')} />)
    expect(fontSizeOf('big')).toBe(60)
  })

  it('scales size/scale with clamped multipliers', () => {
    renderRichText(<RichText nodes={contentFromMfm('$[size.2 big]')} />)
    expect(fontSizeOf('big')).toBe(30)
    renderRichText(<RichText nodes={contentFromMfm('$[scale.x=1.5 big]')} />)
    expect(fontSizeOf('big')).toBe(22.5)
    // Out-of-range clamps instead of exploding.
    renderRichText(<RichText nodes={contentFromMfm('$[size.99 big]')} />)
    expect(fontSizeOf('big')).toBe(60)
  })

  it('degrades an unusable size to its children', () => {
    renderRichText(<RichText nodes={contentFromMfm('$[size.foo big]')} />)
    expect(screen.getByText('big')).toBeTruthy()
  })

  it('renders small below the body size', () => {
    renderRichText(<RichText nodes={contentFromMfm('$[small tiny]')} />)
    expect(fontSizeOf('tiny')).toBe(15 * 0.85)
  })

  it('applies allow-listed hex colors and rejects the rest', () => {
    // Hex literals below are server-provided MFM args under test (input
    // data, like a fixture), not UI chrome — hence the scoped disables.
    renderRichText(
      // eslint-disable-next-line keystone/no-hardcoded-color -- MFM color arg under test
      <RichText nodes={[fnNode('color', {c: '#ff0000'}, [t('red')])]} />,
    )
    const red = StyleSheet.flatten(screen.getByText('red').props.style) as {color?: string}
    // eslint-disable-next-line keystone/no-hardcoded-color -- expected MFM color value
    expect(red?.color).toBe('#ff0000')
    renderRichText(
      // eslint-disable-next-line keystone/no-hardcoded-color -- MFM color arg under test
      <RichText nodes={[fnNode('bg', {c: '#00ff00'}, [t('lime')])]} />,
    )
    const lime = StyleSheet.flatten(screen.getByText('lime').props.style) as {
      backgroundColor?: string
    }
    // eslint-disable-next-line keystone/no-hardcoded-color -- expected MFM color value
    expect(lime?.backgroundColor).toBe('#00ff00')
    // Names, functions and URLs never reach a style.
    renderRichText(<RichText nodes={contentFromMfm('$[color.red hi]')} />)
    expect(screen.getByText('hi')).toBeTruthy()
    const plain = StyleSheet.flatten(screen.getByText('hi').props.style) as {color?: string}
    expect(plain?.color).not.toBe('red')
  })

  it('rotates within the clamped range', () => {
    renderRichText(<RichText nodes={contentFromMfm('$[rotate.90 hi]')} />)
    const flat = StyleSheet.flatten(screen.getByText('hi').props.style) as {
      transform?: Array<{rotate?: string}>
    }
    expect(flat?.transform).toEqual([{rotate: '90deg'}])
    renderRichText(<RichText nodes={contentFromMfm('$[rotate.0 hi]')} />)
    const still = StyleSheet.flatten(screen.getByText('hi').props.style) as {
      transform?: unknown
    }
    expect(still?.transform).toBeUndefined()
  })

  it('maps allow-listed fonts and drops the rest', () => {
    renderRichText(<RichText nodes={contentFromMfm('$[font.monospace code]')} />)
    const mono = StyleSheet.flatten(screen.getByText('code').props.style) as {
      fontFamily?: string
    }
    expect(mono?.fontFamily).toBe('monospace')
    // `$[font.comicsans hi]` parses as an fn with an unmapped family: the
    // content stays, unstyled. (A dash in the family breaks fn parsing in
    // mfm-js itself, so the unknown-family shape must be dash-free.)
    renderRichText(<RichText nodes={contentFromMfm('$[font.comicsans hi]')} />)
    expect(screen.getByText('hi')).toBeTruthy()
  })

  it('centers a top-level decoration as a block', () => {
    renderRichText(<RichText nodes={contentFromMfm('$[center middle]')} />)
    const flat = StyleSheet.flatten(screen.getByText('middle').props.style) as {
      textAlign?: string
    }
    expect(flat?.textAlign).toBe('center')
  })

  it('degrades spin, blur and unknown functions to their children', () => {
    renderRichText(<RichText nodes={contentFromMfm('$[spin whir]')} />)
    expect(screen.getByText('whir')).toBeTruthy()
    renderRichText(<RichText nodes={contentFromMfm('$[blur soft]')} />)
    expect(screen.getByText('soft')).toBeTruthy()
    renderRichText(<RichText nodes={contentFromMfm('$[tada party]')} />)
    expect(screen.getByText('party')).toBeTruthy()
  })

  it('composes nested decorations', () => {
    const {toJSON} = renderRichText(<RichText nodes={contentFromMfm('$[x2 a $[small deep]]')} />)
    // The nested decoration multiplies onto the outer size.
    expect(fontSizeOf('deep')).toBe(15 * 2 * 0.85)
    expect(JSON.stringify(toJSON())).toContain('a ')
  })
})

describe('RichText structural markers (MD4 remainder)', () => {
  it('renders bullet markers and headings, never as plain-text prefixes', () => {
    const {toJSON} = renderRichText(
      <RichText
        nodes={contentFromHtml('<h1>Title</h1><ul><li>one</li><li>two</li></ul>')}
      />,
    )
    expect(screen.getByText('Title')).toBeTruthy()
    expect(fontSizeOf('Title')).toBe(21)
    // Each bullet is its own element (the renderer owns the glyph); the
    // item text shares the parent run, so assert both halves.
    expect(screen.getAllByText('• ')).toHaveLength(2)
    const json = JSON.stringify(toJSON())
    expect(json).toContain('one')
    expect(json).toContain('two')
    expect(json).not.toContain('• one')
  })

  it('never renders invisible text visibly', () => {
    const {toJSON} = renderRichText(
      <RichText
        nodes={contentFromHtml(
          '<p>https://example.social/<span class="invisible">very/long/hidden/part</span><span>…</span></p>',
        )}
        testID="hidden"
      />,
    )
    expect(screen.queryByText('very/long/hidden/part')).toBeNull()
    expect(JSON.stringify(toJSON())).not.toContain('very/long/hidden/part')
    // The visible runs still render around the zero-width span.
    expect(screen.getByText(/https:\/\/example\.social\//)).toBeTruthy()
  })

  it('renders span.mchip content inline as a chip', () => {
    const onLink = jest.fn()
    renderRichText(
      <RichText
        nodes={contentFromHtml(
          '<p><span class="mchip"><a href="https://example.com/x">label</a></span></p>',
        )}
        onLinkPress={onLink}
      />,
    )
    fireEvent.press(screen.getByText('label'))
    expect(onLink).toHaveBeenCalledWith('https://example.com/x')
  })

  it('renders bare URLs as shortened chips, never split mid-word', () => {
    const onLink = jest.fn()
    renderRichText(
      <RichText
        nodes={contentFromMfm(
          'see https://www.bbc.co.uk/news/live/ckgel5xp2xv9t for details',
        )}
        onLinkPress={onLink}
      />,
    )
    // Scheme stripped, truncated, one atomic pill.
    expect(screen.getByText('www.bbc.co.uk/news/live/ckgel5x…')).toBeTruthy()
    expect(screen.getByTestId('richtext-link-chip')).toBeTruthy()
    fireEvent.press(screen.getByTestId('richtext-link-chip'))
    expect(onLink).toHaveBeenCalledWith('https://www.bbc.co.uk/news/live/ckgel5xp2xv9t')
  })

  it('renders server-shortened links as chips with the visible label', () => {
    renderRichText(
      <RichText
        nodes={contentFromHtml(
          '<p><a href="https://example.social/very/long/hidden/part">example.social/very/long<span class="invisible">hidden/part</span><span>…</span></a></p>',
        )}
      />,
    )
    expect(screen.getByText('example.social/very/long…')).toBeTruthy()
    expect(screen.getByTestId('richtext-link-chip')).toBeTruthy()
  })

  it('resolves mention chips to avatar + display name when a backend is wired', async () => {    const account = jest.fn(async () => ({
      id: 'u1',
      username: 'rob',
      host: 'cloudisland.nz',
      name: 'Rob Isaac',
      displayName: 'Rob Isaac',
      avatarUrl: 'https://cloudisland.nz/rob.png',
    }))
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light">
          <QueryClientProvider client={qc}>
            <RichText
              nodes={contentFromHtml('<p>hi <a href="https://x/@rob" class="mention">@rob</a></p>')}
              backend={{account} as never}
              sessionId="sess-1"
            />
          </QueryClientProvider>
        </ThemeProvider>
      </I18nProvider>,
    )
    expect(await screen.findByTestId('richtext-mention-avatar')).toBeTruthy()
    expect(screen.getByText('Rob Isaac')).toBeTruthy()
    expect(account).toHaveBeenCalledWith({username: 'rob', host: null})
  })

  it('resolves bridged dotted-handle mentions through either family backend', async () => {
    const account = jest.fn(async () => ({
      id: 'u9',
      username: 'alice.bsky.social',
      host: 'bsky.brid.gy',
      name: 'Alice',
      displayName: 'Alice',
      avatarUrl: 'https://bsky.brid.gy/alice.png',
    }))
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light">
          <QueryClientProvider client={qc}>
            <RichText
              nodes={contentFromMfm('hi @alice.bsky.social@bsky.brid.gy')}
              backend={{account} as never}
              sessionId="sess-1"
            />
          </QueryClientProvider>
        </ThemeProvider>
      </I18nProvider>,
    )
    expect(await screen.findByTestId('richtext-mention-avatar')).toBeTruthy()
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(account).toHaveBeenCalledWith({username: 'alice.bsky.social', host: 'bsky.brid.gy'})
  })

  it('prefers page titles on link chips when known', () => {
    renderRichText(
      <RichText
        nodes={contentFromMfm('see https://www.bbc.co.uk/news/live/ckgel5xp2xv9t here')}
        linkTitles={{'https://www.bbc.co.uk/news/live/ckgel5xp2xv9t': 'Formal Verification Breakthrough'}}
      />,
    )
    expect(screen.getByText('Formal Verification Breakthrough')).toBeTruthy()
    expect(screen.queryByText(/bbc\.co\.uk/)).toBeNull()
  })

  it('degrades a lone link chip to text when its embed shows', () => {
    renderRichText(
      <RichText
        nodes={contentFromMfm('see https://a.b/x here')}
        hideLoneLinkChipFor="https://a.b/x"
      />,
    )
    expect(screen.getByText('a.b/x')).toBeTruthy()
    expect(screen.queryByTestId('richtext-link-chip')).toBeNull()
  })

  it('renders resolvable mentions as chips, unresolvable as plain text', () => {
    const onMention = jest.fn()
    renderRichText(
      <RichText
        nodes={contentFromHtml(
          '<p>hi <a href="https://a.b/@u" class="mention">@u</a> and <a href="https://a.b/x">plain label</a></p>',
        )}
        onMentionPress={onMention}
      />,
    )
    expect(screen.getByTestId('richtext-mention-chip')).toBeTruthy()
    expect(screen.getByText('@u')).toBeTruthy()
    fireEvent.press(screen.getByTestId('richtext-mention-chip'))
    expect(onMention).toHaveBeenCalledWith('https://a.b/@u', '@u')
    // A labeled non-mention link stays a text link, never a chip.
    expect(screen.getByText('plain label')).toBeTruthy()
    expect(screen.queryByTestId('richtext-link-chip')).toBeNull()
  })
})

describe('RichText plain projection (auto vs plain)', () => {
  it('auto renders full MFM decorations, never raw source', () => {
    const {toJSON} = renderRichText(
      <RichText nodes={contentFromMfm('$[x2 big] and #tag')} testID="auto" />,
    )
    expect(JSON.stringify(toJSON())).not.toContain('$[x2')
    expect(fontSizeOf('big')).toBe(30)
  })

  it('plain projects decorations, bullets, headings — and drops hidden runs', () => {
    appearanceStore.setContentMode('plain')
    try {
      renderRichText(
        <RichText
          nodes={contentFromMfm('$[x2 big] and #tag')}
          testID="plain-mfm"
        />,
      )
      expect(screen.getByText('big and #tag')).toBeTruthy()
      renderRichText(
        <RichText
          nodes={contentFromHtml(
            '<h1>Title</h1><ul><li>one</li></ul><p>a<span class="invisible">hidden</span>b</p>',
          )}
          testID="plain-html"
        />,
      )
      expect(screen.getByText('Title\n\n• one\n\nab')).toBeTruthy()
    } finally {
      appearanceStore.setContentMode('auto')
    }
  })
})
