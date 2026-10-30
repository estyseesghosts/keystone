// P6.6 slice 3: clips queries — session scoping, mosaic gating +
// concurrency cap, invalidation helpers.

import {renderHook, waitFor} from '@testing-library/react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

import {createMemoryStore} from '@keystone/fedi';

import {createSessionStore} from '#/state/session/store';
import {SessionProvider} from '#/state/session/SessionProvider';
import type {TokenVault} from '#/storage';

import {clipMosaicQueryKey, clipsQueryKey} from './keys';
import {resetMosaicGate, useClipMosaic, useClips} from './clips';

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
});

const clip = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Fun',
  isPublic: false,
  description: null,
  notesCount: 1,
  ...over,
});

function pagesMod(over: Record<string, unknown> = {}) {
  return {
    list: jest.fn(async () => ({items: [clip()], cursor: null, end: true})),
    show: jest.fn(async () => clip()),
    ...over,
  };
}

function backend(clips?: Record<string, unknown> | null) {
  return {family: 'misskey', capabilities: {clips: 'supported'}, ...(clips ? {clips} : {})} as never;
}

async function signedInStore() {
  const store = createSessionStore({
    storage: createMemoryStore(),
    vault: memVault(),
    homeOrigin: 'https://a.example',
  });
  await store.add({
    origin: 'https://a.example',
    family: 'misskey',
    flavor: 'misskey',
    accountId: 'alice',
    token: 'token-alice',
    grant: 'miauth',
    hosting: 'third-party',
  });
  const ids = store.getSnapshot().sessions.map(s => s.id);
  return {store, ids};
}

function wrapper(store: unknown, client = new QueryClient({defaultOptions: {queries: {retry: false}}})) {
  return ({children}: {children: React.ReactNode}) => (
    <SessionProvider store={store as never} homeOrigin="https://a.example">
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SessionProvider>
  );
}

describe('clips query keys', () => {
  it('scope every key by session first', () => {
    expect(clipsQueryKey('s1', 'mine')[0]).toBe('s1');
    expect(clipMosaicQueryKey('s1', 'c1')[0]).toBe('s1');
    expect(clipsQueryKey('s1', 'mine')).not.toEqual(clipsQueryKey('s2', 'mine'));
  });
});

describe('useClips', () => {
  it('pages and stays disabled without a session or module', async () => {
    const {store, ids} = await signedInStore();
    const b = backend(pagesMod());
    (b as unknown as {clips: {list: jest.Mock}}).clips.list
      .mockResolvedValueOnce({items: [clip({id: 'a'})], cursor: 'c1', end: false})
      .mockResolvedValueOnce({items: [clip({id: 'b'})], cursor: null, end: true});
    const {result} = renderHook(() => useClips(ids[0]!, {backend: b}), {wrapper: wrapper(store)});
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    const signedOut = renderHook(() => useClips(null, {backend: b}), {wrapper: wrapper(store)});
    expect(signedOut.result.current.fetchStatus).toBe('idle');
    const noModule = renderHook(() => useClips(ids[0]!, {backend: backend(null)}), {wrapper: wrapper(store)});
    expect(noModule.result.current.fetchStatus).toBe('idle');
  });
});

describe('useClipMosaic', () => {
  beforeEach(() => resetMosaicGate());

  it('maps newest notes through collectMosaic and disables cleanly', async () => {
    const {store, ids} = await signedInStore();
    const notes = jest.fn(async () => ({
      items: [
        {
          id: 'n1',
          media: [{id: 'f1', kind: 'image', mimeType: 'image/png', url: 'https://a.example/f1.png'}],
        },
      ],
      cursor: null,
      end: true,
    }));
    const b = backend({notes});
    const {result} = renderHook(() => useClipMosaic(ids[0]!, 'c1', {backend: b}), {wrapper: wrapper(store)});
    await waitFor(() => expect(result.current.data?.images).toEqual([{url: 'https://a.example/f1.png', isSensitive: false}]));
    expect(notes).toHaveBeenCalledWith('c1', {limit: 10});
    const disabled = renderHook(() => useClipMosaic(ids[0]!, 'c1', {backend: b, enabled: false}), {
      wrapper: wrapper(store),
    });
    expect(disabled.result.current.fetchStatus).toBe('idle');
  });

  it('caps in-flight mosaic fetches at 3', async () => {
    const {store, ids} = await signedInStore();
    let live = 0;
    let peak = 0;
    const notes = jest.fn(async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise(r => setTimeout(r, 20));
      live--;
      return {items: [], cursor: null, end: true};
    });
    const b = backend({notes});
    const w = wrapper(store);
    const hooks = [1, 2, 3, 4, 5].map(i =>
      renderHook(() => useClipMosaic(ids[0]!, `c${i}`, {backend: b}), {wrapper: w}),
    );
    await waitFor(() => expect(hooks.every(h => h.result.current.data !== undefined)).toBe(true), {timeout: 10000});
    expect(peak).toBeLessThanOrEqual(3);
    expect(notes).toHaveBeenCalledTimes(5);
  });
});
