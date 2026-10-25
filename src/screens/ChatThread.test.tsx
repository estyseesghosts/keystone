// X2.3: a server-supplied chat file URL is vetted before it becomes a
// link — non-http(s) file URLs render as plain text, never as a Pressable.
// X3.3: a failed page never refires from scroll — only the footer Retry
// fetches again.
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'
import type {ReactElement} from 'react'

import type {ChatMessage, Media} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {i18n} from '#/locale/i18n'

import {ChatThread, type ChatThreadData} from './ChatThread'

function media(url: string | null): Media {
  return {
    id: 'f1',
    kind: 'file',
    mimeType: 'text/plain',
    url,
    previewUrl: null,
    name: 'note.txt',
    description: null,
    blurhash: null,
    isSensitive: false,
    size: 1,
    md5: null,
    meta: null,
    createdAt: null,
    folderId: null,
    userId: null,
  }
}

function message(url: string | null): ChatMessage {
  return {
    id: 'm1',
    createdAt: '2026-10-25T00:00:00.000Z',
    text: 'see attached',
    fromAccountId: 'u1',
    fromAccount: null,
    toUserId: 'u2',
    toRoomId: null,
    fileId: 'f1',
    file: media(url),
    reactions: [],
    read: null,
  }
}

function threadWith(items: ChatMessage[], over: Partial<ChatThreadData> = {}): ChatThreadData {
  return {
    pages: undefined,
    items,
    isPending: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetching: false,
    fetchNextPage: () => {},
    refetch: () => {},
    ...over,
  }
}

function setup(url: string | null, threadOver: Partial<ChatThreadData> = {}): {unmount: () => void} {
  const tree: ReactElement = (
    <QueryClientProvider client={new QueryClient()}>
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <ChatThread
          testPrefix="chat-user"
          thread={threadWith([message(url)], threadOver)}
          emptyLabel="No messages."
          sendLabel="Write a message."
          sending={false}
          sendError={null}
          onSend={() => Promise.resolve()}
          viewerAccountId="u2"
          deleteState={{deletingId: null, error: null}}
          onDelete={() => {}}
        />
      </ThemeProvider>
    </I18nProvider>
    </QueryClientProvider>
  )
  return render(tree)
}

describe('ChatThread attachment link vetting (X2.3)', () => {
  it('renders no link for a javascript: file URL', () => {
    setup('javascript:alert(1)')
    expect(screen.queryByTestId('chat-attachment-open-m1')).toBeNull()
    // The file is still named — only the link is gone.
    expect(screen.getByTestId('chat-attachment-m1')).toBeTruthy()
  })

  it('renders no link for tel:/intent:/file:/data: file URLs', () => {
    for (const url of ['tel:+123456', 'intent://a.b/#Intent;scheme=https;end', 'file:///etc/passwd', 'data:text/html,x']) {
      const {unmount} = setup(url)
      expect(screen.queryByTestId('chat-attachment-open-m1')).toBeNull()
      unmount()
    }
  })

  it('renders the link for an https file URL', () => {
    setup('https://files.example/note.txt')
    expect(screen.getByTestId('chat-attachment-open-m1')).toBeTruthy()
    // X9.2: the send chrome renders translated (English source catalog).
    expect(screen.getByText('Send')).toBeTruthy()
  })
})

describe('ChatThread paging gate (X3.3)', () => {
  it('error state + 20 scroll events = 0 extra requests; only Retry fetches', () => {
    const fetchNextPage = jest.fn()
    setup('https://files.example/note.txt', {
      hasNextPage: true,
      isFetchingNextPage: false,
      isFetchNextPageError: true,
      error: new Error('flaky'),
      fetchNextPage,
    })
    expect(screen.getByTestId('chat-user-more-retry')).toBeTruthy()
    const list = screen.getByTestId('chat-user-list')
    const onEndReached = (list.props as {onEndReached: () => void}).onEndReached
    for (let i = 0; i < 20; i++) onEndReached()
    expect(fetchNextPage).not.toHaveBeenCalled()
    fireEvent.press(screen.getByTestId('chat-user-more-retry'))
    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })
})
