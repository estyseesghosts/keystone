// Typed test factories (repair X11.2, test quality).
//
// One sanctioned place for the casts the suites used to repeat inline:
// every `as unknown as` below lives here, in a non-test helper file, so
// the `*.test.ts` suites themselves stay cast-free. The domain defaults
// mirror `src/components/__tests__/fixtures.ts` (same names, same ids);
// that file stays the app-side home, this file the fedi-side home — one
// convention, two doors (fedi tests cannot import from `src/`).

import type { Account, Media, Notification, Post } from "../src/core/models";
import type { Session } from "../src/core/sessions";
import type { FetchImpl } from "../src/core/http";

export function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "a1",
    username: "alice",
    acct: "alice@example.social",
    host: "example.social",
    name: "Alice",
    displayName: "Alice",
    bio: { plain: "" },
    url: "https://example.social/@alice",
    uri: "https://example.social/users/alice",
    avatarUrl: null,
    avatarBlurhash: null,
    headerUrl: null,
    headerBlurhash: null,
    backgroundUrl: null,
    followersCount: 10,
    followingCount: 5,
    statusesCount: 42,
    locked: false,
    bot: false,
    cat: false,
    silenced: false,
    suspended: false,
    onlineStatus: null,
    location: null,
    birthday: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: null,
    lastFetchedAt: null,
    emojis: {},
    fields: [],
    movedTo: null,
    ffVisibility: null,
    pinnedPostIds: null,
    pinnedPosts: null,
    ext: {},
    ...overrides,
  };
}

export function makeMedia(overrides: Partial<Media> = {}): Media {
  return {
    id: "m1",
    kind: "image",
    mimeType: "image/png",
    url: "https://example.social/media/1.png",
    previewUrl: null,
    name: "image",
    description: null,
    blurhash: null,
    isSensitive: false,
    size: null,
    md5: null,
    meta: null,
    createdAt: null,
    folderId: null,
    userId: null,
    ...overrides,
  };
}

export function makePost(overrides: Partial<Post> = {}): Post {
  const author = overrides.author ?? makeAccount();
  return {
    id: "p1",
    createdAt: "2026-10-19T12:00:00.000Z",
    author,
    accountId: author.id,
    content: { mfm: "Hello **world** :wave:", plain: "Hello world wave" },
    cw: null,
    visibility: { kind: "public", localOnly: false, raw: "public" },
    counts: { replies: 2, boosts: 3, quotes: 0, reactions: 5, favourites: 5 },
    reactions: {
      total: 5,
      entries: [{ key: "❤", count: 5, mine: false, url: null }],
      mine: null,
      myReactions: [],
      urls: {},
    },
    favourite: { count: 5, mine: false },
    media: [],
    mediaIds: [],
    poll: null,
    card: null,
    quote: null,
    quoteState: null,
    quoteUnavailable: false,
    renote: null,
    reply: null,
    replyToId: null,
    renoteId: null,
    uri: "https://example.social/notes/p1",
    url: "https://example.social/notes/p1",
    emojis: { wave: "https://example.social/emoji/wave.png" },
    mentions: [],
    tags: [],
    editedAt: null,
    filtered: [],
    pinned: false,
    ext: {},
    ...overrides,
  };
}

export function makeNotification(
  overrides: Partial<Notification> = {},
): Notification {
  return {
    id: "n1",
    kind: "mention",
    rawType: "mention",
    createdAt: "2026-10-19T12:00:00.000Z",
    read: null,
    actors: [],
    post: null,
    reaction: null,
    ext: {},
    ...overrides,
  };
}

/** A complete `Session`. `id` derives from origin + accountId unless given. */
export function makeSession(over: Partial<Session> = {}): Session {
  const origin = over.origin ?? "https://s.example";
  const accountId = over.accountId ?? "acc1";
  return {
    origin,
    family: "misskey",
    flavor: "misskey",
    accountId,
    token: "test-token",
    grant: "password",
    hosting: "third-party",
    id: `${origin} ${accountId}`,
    ...over,
  };
}

// --- Fetch doubles ---------------------------------------------------------

export type FetchHandler = (
  url: string,
  init: RequestInit,
) => Response | Promise<Response>;

/**
 * A `FetchImpl`-typed spy around `handler`. The mock handle is returned
 * alongside so tests can assert call counts without casting
 * `fetchImpl.mock.calls[0]` (see `firstFetchCall`). (Never `typeof fetch`:
 * the `no-ui-in-fedi` rule bans the bare global even in type position —
 * the seam type says the same thing.)
 */
export function makeFetchSpy(
  handler: FetchHandler = () =>
    new Response("{}", { status: 200 }),
): { fetchImpl: FetchImpl; mock: jest.Mock } {
  const mock: jest.Mock = jest.fn((...args: any[]) =>
    handler(String(args[0]), (args[1] ?? {}) as RequestInit),
  );
  const fetchImpl: FetchImpl = mock as unknown as FetchImpl;
  return { fetchImpl, mock };
}

/** The `[url, init]` pair of one recorded fetch call, fully typed. */
export function fetchCallAt(
  mock: jest.Mock,
  index = 0,
): [string, RequestInit] {
  const call = mock.mock.calls[index] as [unknown, unknown?];
  return [String(call[0]), (call[1] ?? {}) as RequestInit];
}

/** Shorthand for the first recorded call (the common single-request case). */
export function firstFetchCall(mock: jest.Mock): [string, RequestInit] {
  return fetchCallAt(mock, 0);
}
