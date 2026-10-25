// Composer media descriptions (clickstone §1.7): existing attachments (edit
// mode and delete-and-redraft) expose an editable alt field, and a changed
// description is saved through `Backend.updateMedia` BEFORE the post itself
// is written — the old path passed `alt: ''` and dropped captions entirely.

import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {buildCapabilities, createMemoryStore, type Backend, type Post, type Session} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'

import {makeMedia, makePost} from '../__tests__/fixtures'
import {Composer, type ComposerProps} from './Composer'
import {pickMedia} from './pickMedia'

jest.mock('./pickMedia', () => ({pickMedia: jest.fn(async () => ({kind: 'cancelled'}))}))
jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  fetchComposeLimits: jest.fn(async () => ({maxChars: 500, maxMedia: 4, maxPollOptions: 4})),
}))

const session = (family: 'misskey' | 'mastodon', flavor: string): Session =>
  ({
    id: 'https://s.example me',
    origin: 'https://s.example',
    family,
    flavor,
    accountId: 'me',
    token: 'tok',
  }) as unknown as Session

function backend(flavor: 'sharkey' | 'mastodon', extra: Partial<Backend> = {}): Backend {
  return {
    family: flavor === 'mastodon' ? 'mastodon' : 'misskey',
    capabilities: buildCapabilities(flavor),
    createPost: jest.fn().mockResolvedValue({id: 'new', author: {id: 'me'}}),
    editPost: jest.fn().mockResolvedValue({id: 'p9', author: {id: 'me'}}),
    customEmojis: jest.fn().mockResolvedValue([]),
    search: {},
    uploadMedia: jest.fn().mockResolvedValue({id: 'm1'}),
    ...extra,
  } as unknown as Backend
}

function editingPost(over: Partial<Post> = {}): Post {
  return makePost({
    id: 'p9',
    author: {id: 'me'} as Post['author'],
    content: {mfm: 'orig', plain: 'orig'},
    mediaIds: ['m1'],
    media: [makeMedia({id: 'm1', description: 'old alt'})],
    ...over,
  })
}

function renderComposer(props: Partial<ComposerProps> & {session: Session; backend: Backend}) {
  const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <Composer store={createMemoryStore()} onClose={() => {}} {...props} />
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

describe('Composer media descriptions', () => {
  it('edit mode seeds the current alt text and saves a change through updateMedia first', async () => {
    const order: string[] = []
    const b = backend('mastodon', {
      updateMedia: jest.fn(async () => {
        order.push('updateMedia')
        return makeMedia({id: 'm1', description: 'new alt'})
      }),
      editPost: jest.fn(async () => {
        order.push('editPost')
        return editingPost()
      }),
    })
    renderComposer({session: session('mastodon', 'mastodon'), backend: b, editing: editingPost()})

    const alt = screen.getByTestId('composer-seeded-alt-m1')
    expect(alt.props.value).toBe('old alt')
    fireEvent.changeText(alt, 'new alt')
    fireEvent.press(screen.getByTestId('composer-submit'))

    await waitFor(() => expect(b.editPost).toHaveBeenCalledTimes(1))
    expect(b.updateMedia).toHaveBeenCalledWith('m1', {description: 'new alt'})
    expect(order).toEqual(['updateMedia', 'editPost'])
    // The unchanged attachment id still rides the edit.
    expect(b.editPost).toHaveBeenCalledWith('p9', expect.objectContaining({mediaIds: ['m1']}))
  })

  it('does not call updateMedia when no description changed', async () => {
    const b = backend('sharkey', {updateMedia: jest.fn()})
    renderComposer({session: session('misskey', 'sharkey'), backend: b, editing: editingPost()})
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(b.editPost).toHaveBeenCalledTimes(1))
    expect(b.updateMedia).not.toHaveBeenCalled()
  })

  it('clears a description by sending null', async () => {
    const b = backend('mastodon', {updateMedia: jest.fn(async () => makeMedia({id: 'm1'}))})
    renderComposer({session: session('mastodon', 'mastodon'), backend: b, editing: editingPost()})
    fireEvent.changeText(screen.getByTestId('composer-seeded-alt-m1'), '   ')
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(b.updateMedia).toHaveBeenCalledWith('m1', {description: null}))
  })

  it('locks the field with an honest reason where the backend has no media edit', async () => {
    const b = backend('sharkey')
    renderComposer({session: session('misskey', 'sharkey'), backend: b, editing: editingPost()})
    expect(screen.getByTestId('composer-seeded-alt-reason-m1')).toHaveTextContent(
      'This server cannot change a description after upload.',
    )
    expect(screen.getByTestId('composer-seeded-alt-m1').props.editable).toBe(false)
  })

  it('a redraft seed fills the composer and keeps the attachments on create', async () => {
    const b = backend('mastodon', {updateMedia: jest.fn(async () => makeMedia({id: 'm1'}))})
    renderComposer({
      session: session('mastodon', 'mastodon'),
      backend: b,
      redraftSeed: {
        text: 'redrafted',
        cw: 'cw',
        cwEnabled: true,
        visibilityRaw: 'unlisted',
        media: [{id: 'm1', alt: 'old alt', originalAlt: 'old alt', previewUrl: null}],
      },
    })
    expect(screen.getByTestId('composer-text').props.value).toBe('redrafted')
    expect(screen.getByTestId('composer-seeded-m1')).toBeTruthy()
    fireEvent.changeText(screen.getByTestId('composer-seeded-alt-m1'), 'better alt')
    fireEvent.press(screen.getByTestId('composer-submit'))

    await waitFor(() => expect(b.createPost).toHaveBeenCalledTimes(1))
    expect(b.updateMedia).toHaveBeenCalledWith('m1', {description: 'better alt'})
    expect(b.createPost).toHaveBeenCalledWith(
      expect.objectContaining({text: 'redrafted', cw: 'cw', mediaIds: ['m1']}),
    )
    expect(b.editPost).not.toHaveBeenCalled()
  })

  it('keeps seeded attachments when a new upload is added (F1)', async () => {
    // Repair X6.1 F1: 2 seeded + 1 new must all ride the edit. Before the
    // fix only the new id was sent and the seeded two were dropped.
    const pickMediaMock = pickMedia as jest.MockedFunction<typeof pickMedia>
    pickMediaMock.mockResolvedValueOnce({
      kind: 'picked',
      files: [{file: new File(['x'], 'new.png'), name: 'new.png', previewUri: null}],
      rejected: [],
    })
    const editPost = jest.fn(async () => editingPost())
    const b = backend('sharkey', {
      editPost,
      uploadMedia: jest.fn(async () => makeMedia({id: 'm3'})),
      updateMedia: jest.fn(),
    })
    const seeded = editingPost({
      mediaIds: ['m1', 'm2'],
      media: [makeMedia({id: 'm1', description: 'a'}), makeMedia({id: 'm2', description: 'b'})],
    })
    renderComposer({session: session('misskey', 'sharkey'), backend: b, editing: seeded})
    fireEvent.press(screen.getByTestId('composer-media-add'))
    await screen.findByTestId(/^composer-upload-sensitive-/)
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(editPost).toHaveBeenCalledTimes(1))
    expect(editPost).toHaveBeenCalledWith('p9', expect.objectContaining({mediaIds: ['m1', 'm2', 'm3']}))
  })

  it('removing the only attachment sends explicit empty mediaIds (F1)', async () => {
    // Before the fix an emptied `state.media` fell back to
    // `editing.mediaIds`, so the image silently stayed.
    const editPost = jest.fn(async () => editingPost({mediaIds: [], media: []}))
    const b = backend('sharkey', {editPost, updateMedia: jest.fn()})
    renderComposer({session: session('misskey', 'sharkey'), backend: b, editing: editingPost()})
    fireEvent.press(screen.getByTestId('composer-seeded-remove-m1'))
    expect(screen.queryByTestId('composer-seeded-m1')).toBeNull()
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(editPost).toHaveBeenCalledTimes(1))
    expect(editPost).toHaveBeenCalledWith('p9', expect.objectContaining({mediaIds: []}))
  })

  it('disables Remove, alt, add-media, poll, visibility and CW while an edit saves (F3)', async () => {
    // The save is held open so `busy` stays true while we assert.
    let release!: (v: unknown) => void
    const gate = new Promise<unknown>(resolve => {
      release = resolve
    })
    const updated = editingPost({cw: 'warn'})
    const editPost = jest.fn().mockReturnValue(gate.then(() => updated))
    const b = backend('mastodon', {
      editPost,
      updateMedia: jest.fn(async () => makeMedia({id: 'm1'})),
    })
    const seeded = editingPost({
      cw: 'warn',
      mediaIds: ['m1'],
      media: [makeMedia({id: 'm1', description: 'old alt'})],
    })
    renderComposer({session: session('mastodon', 'mastodon'), backend: b, editing: seeded})
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(screen.getByTestId('composer-submit')).toBeDisabled())
    // Seeded remove + alt freeze with a reason.
    expect(screen.getByTestId('composer-seeded-remove-m1')).toBeDisabled()
    expect(screen.getByTestId('composer-seeded-remove-m1').props.accessibilityHint).toBe('Saving…')
    expect(screen.getByTestId('composer-seeded-alt-m1').props.editable).toBe(false)
    expect(screen.getByTestId('composer-seeded-busy-reason-m1')).toBeTruthy()
    // Add-media, poll, visibility and CW freeze with the same reason.
    expect(screen.getByTestId('composer-media-add')).toBeDisabled()
    expect(screen.getByTestId('composer-media-add').props.accessibilityHint).toBe('Saving…')
    expect(screen.getByTestId('composer-poll-toggle')).toBeDisabled()
    expect(screen.getByTestId('composer-poll-toggle').props.accessibilityHint).toBe('Saving…')
    expect(screen.getByTestId('composer-vis-public')).toBeDisabled()
    expect(screen.getByTestId('composer-cw-toggle')).toBeDisabled()
    expect(screen.getByTestId('composer-cw-toggle').props.accessibilityHint).toBe('Saving…')
    expect(screen.getByTestId('composer-cw').props.editable).toBe(false)
    release(updated)
    await waitFor(() => expect(editPost).toHaveBeenCalledTimes(1))
  })

  it('ignores an alt edit attempted while the edit save is in flight (F3)', async () => {
    // With the controls frozen, a mid-submit keystroke never reaches state,
    // so the media edit cannot send a stale description.
    let release!: (v: unknown) => void
    const gate = new Promise<unknown>(resolve => {
      release = resolve
    })
    const updated = editingPost()
    const updateMedia = jest.fn(async () => makeMedia({id: 'm1', description: 'old alt'}))
    const editPost = jest.fn().mockReturnValue(gate.then(() => updated))
    const b = backend('mastodon', {editPost, updateMedia})
    renderComposer({session: session('mastodon', 'mastodon'), backend: b, editing: editingPost()})
    fireEvent.press(screen.getByTestId('composer-submit'))
    await waitFor(() => expect(screen.getByTestId('composer-submit')).toBeDisabled())
    fireEvent.changeText(screen.getByTestId('composer-seeded-alt-m1'), 'sneaked in')
    // Blocked: the visible value never changes.
    expect(screen.getByTestId('composer-seeded-alt-m1').props.value).toBe('old alt')
    release(updated)
    await waitFor(() => expect(editPost).toHaveBeenCalledTimes(1))
    expect(updateMedia).not.toHaveBeenCalled()
  })
})
