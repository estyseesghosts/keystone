import {fireEvent, render, screen} from '@testing-library/react-native'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {createMemoryStore} from '@keystone/fedi'

import {EmojiPicker, customEmojiQueryKey} from './EmojiPicker'
import {buildPickerSections, sectionsToRows} from './model'
import {createEmojiRecentsStore} from './recents'

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
