import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {Platform} from 'react-native'

import {createMemoryStore} from '@keystone/fedi'
import {i18n} from '#/locale/i18n'

import {createEmojiGroupPrefsStore, createFavouritesStore, likeEmojiStore} from '#/state/emojiPrefs'
import {clearToasts, toastStore} from '#/lib/toast'

import {EmojiPicker, customEmojiQueryKey} from './EmojiPicker'
import {buildPickerSections, pickedFromKey, sectionsToRows, type PickerRow} from './model'
import {createEmojiRecentsStore} from './recents'

i18n.load('en', {})
i18n.activate('en')

jest.mock('#/screens/HomeFeed', () => ({useBackendForSessionId: () => null}))

const S1 = 'https://a.example acct1'
const S2 = 'https://b.example acct1'
const custom = [
  {name: 'blobcat', url: 'https://a.example/blobcat.png', category: 'blobs'},
  {name: 'party', url: 'https://a.example/party.png', category: null},
]

describe('emoji picker model', () => {
  it('groups custom by category and includes unicode categories', () => {
    const s = buildPickerSections({custom, recents: [], query: ''})
    expect(s.map(x => x.id)).toEqual(expect.arrayContaining(['custom:blobs', 'custom:Uncategorized', 'unicode:face']))
    expect(s.find(x => x.id === 'custom:blobs')!.items[0]).toEqual({kind: 'custom', key: ':blobcat:', url: 'https://a.example/blobcat.png'})
  })
  it('search filters custom by name (colons ignored), unicode by char and by category', () => {
    const s = buildPickerSections({custom, recents: [], query: ':blob'})
    expect(s.filter(x => x.id.startsWith('custom:')).map(x => x.id)).toEqual(['custom:blobs'])
    expect(buildPickerSections({custom, recents: [], query: '😀'}).some(x => x.id === 'unicode:face')).toBe(true)
    expect(buildPickerSections({custom, recents: [], query: 'zzzzqq'})).toEqual([])
  })
  it('recents show only without a query; rows chunk by columns', () => {
    const r = [{kind: 'unicode' as const, key: '🔥'}]
    expect(buildPickerSections({custom: [], recents: r, query: ''})[0].id).toBe('recents')
    expect(buildPickerSections({custom: [], recents: r, query: 'x'}).some(x => x.id === 'recents')).toBe(false)
    const rows = sectionsToRows([{id: 'a', title: 'A', items: Array.from({length: 10}, (_, i) => ({kind: 'unicode' as const, key: String(i)}))}], 4)
    expect(rows.map(x => x.type)).toEqual(['header', 'items', 'items', 'items'])
  })
  it('adds a favourites section without a query only', () => {
    const favs = [pickedFromKey('🔥'), pickedFromKey(':blobcat:')]
    const s = buildPickerSections({custom: [], recents: [], query: '', favourites: favs})
    expect(s[0]).toEqual({id: 'favourites', title: 'Favourites', items: favs})
    expect(
      buildPickerSections({custom: [], recents: [], query: 'fire', favourites: favs}).some(
        x => x.id === 'favourites',
      ),
    ).toBe(false)
  })
  it('hides hidden groups (custom and unicode), orders favourites first and pinned as one block', () => {
    const recents = [{kind: 'unicode' as const, key: '🔥'}]
    const favs = [pickedFromKey('⭐')]
    const s = buildPickerSections({
      custom,
      recents,
      query: '',
      favourites: favs,
      hiddenGroups: ['blobs', 'face'],
      pinnedGroups: ['Uncategorized', 'symbols', 'nope'],
    })
    const ids = s.map(x => x.id)
    // Favourites first (above recents and every pinned group), recents next.
    expect(ids[0]).toBe('favourites')
    expect(ids[1]).toBe('recents')
    // Pinned block in pin order.
    expect(ids[2]).toBe('custom:Uncategorized')
    expect(ids[3]).toBe('unicode:symbols')
    // Hidden categories absent throughout; unknown pinned names are no-ops.
    expect(ids).not.toContain('custom:blobs')
    expect(ids).not.toContain('unicode:face')
    expect(ids).not.toContain('nope')
  })
  it('maps stored keys back to cells', () => {
    expect(pickedFromKey('🔥')).toEqual({kind: 'unicode', key: '🔥'})
    expect(pickedFromKey(':blobcat:')).toEqual({kind: 'custom', key: ':blobcat:'})
  })
  it('hides custom categories via hiddenGroups', () => {
    const s = buildPickerSections({custom, recents: [], query: '', hiddenGroups: ['blobs']})
    expect(s.some(x => x.id === 'custom:blobs')).toBe(false)
    expect(s.some(x => x.id === 'custom:Uncategorized')).toBe(true)
  })
  it('sectionsToRows carries counts and skips collapsed item rows', () => {
    const sections = buildPickerSections({custom, recents: [], query: ''})
    const rows = sectionsToRows(sections)
    const headers = rows.filter((r): r is Extract<PickerRow, {type: 'header'}> => r.type === 'header')
    expect(headers.find(h => h.sectionId === 'custom:blobs')?.count).toBe(1)
    const collapsed = sectionsToRows(sections, 8, new Set(['custom:blobs']))
    expect(collapsed.some(r => r.type === 'header' && r.sectionId === 'custom:blobs')).toBe(true)
    expect(collapsed.some(r => r.id === 'r:custom:blobs:0')).toBe(false)
    expect(collapsed.some(r => r.id === 'r:custom:Uncategorized:0')).toBe(true)
  })
})

describe('recents store', () => {
  it('is per session, MRU, persisted, deduped', () => {
    const mem = createMemoryStore()
    const st = createEmojiRecentsStore(() => mem)
    st.touch(S1, {kind: 'unicode', key: 'a'})
    st.touch(S1, {kind: 'custom', key: ':b:', url: 'u'})
    st.touch(S1, {kind: 'unicode', key: 'a'})
    expect(st.list(S1).map(e => e.key)).toEqual(['a', ':b:'])
    expect(st.list(S2)).toEqual([])
    expect(createEmojiRecentsStore(() => mem).list(S1)[1]).toEqual({kind: 'custom', key: ':b:', url: 'u'})
  })
  it('survives corrupt storage', () => {
    const mem = createMemoryStore({[`keystone.emojirecents.${S1}`]: '{bad'})
    expect(createEmojiRecentsStore(() => mem).list(S1)).toEqual([])
  })
})

describe('EmojiPicker', () => {
  it('shows session custom emoji, picks, records recents, isolates sessions', () => {
    const qc = new QueryClient({defaultOptions: {queries: {gcTime: Infinity}}})
    qc.setQueryData(customEmojiQueryKey(S1), custom)
    const recentsStore = createEmojiRecentsStore(() => createMemoryStore())
    const onPick = jest.fn()
    const view = render(
      <QueryClientProvider client={qc}>
        <EmojiPicker sessionId={S1} onPick={onPick} recentsStore={recentsStore} />
      </QueryClientProvider>,
    )
    fireEvent.press(screen.getByTestId('emoji-cell-:blobcat:'))
    expect(onPick).toHaveBeenCalledWith({kind: 'custom', key: ':blobcat:', url: 'https://a.example/blobcat.png'})
    expect(recentsStore.list(S1)[0].key).toBe(':blobcat:')
    expect(recentsStore.list(S2)).toEqual([])
    // no ':code:' text rendered before any image failure
    expect(screen.queryByText(':blobcat:')).toBeNull()
    view.unmount()
    render(
      <QueryClientProvider client={qc}>
        <EmojiPicker sessionId={S2} onPick={onPick} recentsStore={recentsStore} />
      </QueryClientProvider>,
    )
    expect(screen.queryByTestId('emoji-cell-:blobcat:')).toBeNull()
  })
  it('search narrows cells', () => {
    const qc = new QueryClient({defaultOptions: {queries: {gcTime: Infinity}}})
    qc.setQueryData(customEmojiQueryKey(S1), custom)
    render(
      <QueryClientProvider client={qc}>
        <EmojiPicker sessionId={S1} onPick={jest.fn()} recentsStore={createEmojiRecentsStore(() => createMemoryStore())} />
      </QueryClientProvider>,
    )
    fireEvent.changeText(screen.getByTestId('emoji-search'), 'party')
    expect(screen.getByTestId('emoji-cell-:party:')).toBeTruthy()
    expect(screen.queryByTestId('emoji-cell-:blobcat:')).toBeNull()
  })
})

describe('collapsible sections', () => {
  function pickerWithGroups(groups = createEmojiGroupPrefsStore(() => createMemoryStore())) {
    const qc = new QueryClient({defaultOptions: {queries: {gcTime: Infinity}}})
    qc.setQueryData(customEmojiQueryKey(S1), custom)
    const view = render(
      <QueryClientProvider client={qc}>
        <EmojiPicker
          sessionId={S1}
          onPick={jest.fn()}
          recentsStore={createEmojiRecentsStore(() => createMemoryStore())}
          groupPrefsStore={groups}
        />
      </QueryClientProvider>,
    )
    return {view, groups}
  }

  it('headers toggle item rows and persist across remounts', () => {
    const mem = createMemoryStore()
    const groups = createEmojiGroupPrefsStore(() => mem)
    const {view} = pickerWithGroups(groups)
    expect(screen.getByTestId('emoji-cell-:blobcat:')).toBeTruthy()
    fireEvent.press(screen.getByTestId('emoji-group-toggle-custom:blobs'))
    expect(screen.queryByTestId('emoji-cell-:blobcat:')).toBeNull()
    expect(screen.getByLabelText('Expand blobs (1)')).toBeTruthy()
    // Collapsed across open sessions: a fresh picker over the same store stays collapsed.
    view.unmount()
    pickerWithGroups(groups)
    expect(screen.queryByTestId('emoji-cell-:blobcat:')).toBeNull()
    fireEvent.press(screen.getByTestId('emoji-group-toggle-custom:blobs'))
    expect(screen.getByTestId('emoji-cell-:blobcat:')).toBeTruthy()
    expect(groups.collapsed()).toEqual([])
  })

  it('search expands collapsed groups instead of hiding hits', () => {
    pickerWithGroups()
    fireEvent.press(screen.getByTestId('emoji-group-toggle-custom:blobs'))
    expect(screen.queryByTestId('emoji-cell-:blobcat:')).toBeNull()
    fireEvent.changeText(screen.getByTestId('emoji-search'), 'blob')
    expect(screen.getByTestId('emoji-cell-:blobcat:')).toBeTruthy()
  })
})

describe('cell context menu (web)', () => {
  let restoreOs: {restore(): void} | null = null
  beforeEach(() => {
    restoreOs = jest.replaceProperty(Platform, 'OS', 'web')
    clearToasts()
  })
  afterEach(() => {
    restoreOs?.restore()
    restoreOs = null
    likeEmojiStore.reset(S1)
  })

  function pickerWithFavs(favs = createFavouritesStore(() => createMemoryStore())) {
    const qc = new QueryClient({defaultOptions: {queries: {gcTime: Infinity}}})
    qc.setQueryData(customEmojiQueryKey(S1), custom)
    render(
      <QueryClientProvider client={qc}>
        <EmojiPicker
          sessionId={S1}
          onPick={jest.fn()}
          recentsStore={createEmojiRecentsStore(() => createMemoryStore())}
          favouritesStore={favs}
        />
      </QueryClientProvider>,
    )
    return {favs}
  }

  function rightClick(testID: string) {
    const prevent = jest.fn()
    fireEvent(screen.getByTestId(testID), 'contextMenu', {preventDefault: prevent})
    expect(prevent).toHaveBeenCalled()
  }

  it('right-click opens the menu; favourite pins to the top section', () => {
    const {favs} = pickerWithFavs()
    rightClick('emoji-cell-:blobcat:')
    expect(screen.getByTestId('emoji-cell-menu')).toBeTruthy()
    fireEvent.press(screen.getByTestId('emoji-menu-favourite'))
    expect(favs.list(S1)).toEqual([':blobcat:'])
    // Menu closes; the favourites quick-access section leads the list.
    expect(screen.queryByTestId('emoji-cell-menu')).toBeNull()
    expect(screen.getByTestId('emoji-group-toggle-favourites')).toBeTruthy()
  })

  it('use as like sets the device like and toasts when the server cannot persist', async () => {
    pickerWithFavs()
    rightClick('emoji-cell-:blobcat:')
    fireEvent.press(screen.getByTestId('emoji-menu-like'))
    expect(likeEmojiStore.get(S1)).toBe(':blobcat:')
    // No backend in this harness: the device value wins, the miss is reported.
    await waitFor(() =>
      expect(toastStore.getSnapshot().map(t => t.message)).toContain(
        'Like saved on this device; this server has no default-reaction field.',
      ),
    )
  })
})
