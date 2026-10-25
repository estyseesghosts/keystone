// X2.3: a server-supplied chat file URL is vetted before it becomes a
// link — non-http(s) file URLs render as plain text, never as a Pressable.
import {I18nProvider} from '@lingui/react'
import {render, screen} from '@testing-library/react-native'
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

function threadWith(items: ChatMessage[]): ChatThreadData {
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
  }
}

function setup(url: string | null): {unmount: () => void} {
  const tree: ReactElement = (
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <ChatThread
          testPrefix="chat-user"
          thread={threadWith([message(url)])}
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
  })
})
