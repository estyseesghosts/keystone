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

jest.mock('./pickMedia', () => ({pickMedia: jest.fn(async () => [])}))
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
})
