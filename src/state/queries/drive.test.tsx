// P6.6 slice 5: drive queries — scoping, paging, mutations with
// invalidation.

import {renderHook, waitFor} from '@testing-library/react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ReactNode} from 'react';

import {createMemoryStore} from '@keystone/fedi';

import {createSessionStore} from '#/state/session/store';
import {SessionProvider} from '#/state/session/SessionProvider';
import type {TokenVault} from '#/storage';

import {driveFilesQueryKey, driveFoldersQueryKey, driveUsageQueryKey} from './keys';
import {useDriveFiles, useDriveFolderMutations, useDriveFolders, useDriveUsage} from './drive';

const memVault = (): TokenVault => ({
  getToken: () => Promise.resolve(null),
  setToken: () => Promise.resolve(),
  removeToken: () => Promise.resolve(),
});

function backend(drive?: Record<string, unknown> | null) {
  return {family: 'misskey', capabilities: {drive: 'supported'}, ...(drive ? {drive} : {})} as never;
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
  return ({children}: {children: ReactNode}) => (
    <SessionProvider store={store as never} homeOrigin="https://a.example">
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SessionProvider>
  );
}

describe('drive query keys', () => {
  it('scope every key by session first', () => {
    expect(driveFoldersQueryKey('s1', 'root')[0]).toBe('s1');
    expect(driveFilesQueryKey('s1', 'root', 'newest')[0]).toBe('s1');
    expect(driveUsageQueryKey('s1')[0]).toBe('s1');
    expect(driveFoldersQueryKey('s1', 'root')).not.toEqual(driveFoldersQueryKey('s2', 'root'));
    expect(driveFilesQueryKey('s1', 'root', 'newest')).not.toEqual(driveFilesQueryKey('s1', 'root', '-createdAt'));
  });
});

describe('useDriveFolders / useDriveFiles', () => {
  it('pages and stays disabled without a session or module', async () => {
    const {store, ids} = await signedInStore();
    const list = jest.fn(async () => ({items: [{id: 'd1'}], cursor: 'c1', end: false}));
    const folders = {list};
    const b = backend({folders});
    const {result} = renderHook(() => useDriveFolders(ids[0]!, null, {backend: b}), {wrapper: wrapper(store)});
await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    expect(list).toHaveBeenCalledWith({parentId: null, limit: 20});
    const files = jest.fn(async () => ({items: [{id: 'f1'}], cursor: null, end: true}));
    const b2 = backend({files});
    const f = renderHook(() => useDriveFiles(ids[0]!, 'd9', {backend: b2}), {wrapper: wrapper(store)});
    await waitFor(() => expect(f.result.current.data?.pages).toHaveLength(1));
    expect(files).toHaveBeenCalledWith({folderId: 'd9', limit: 20});
    const signedOut = renderHook(() => useDriveFiles(null, null, {backend: b2}), {wrapper: wrapper(store)});
    expect(signedOut.result.current.fetchStatus).toBe('idle');
    const noModule = renderHook(() => useDriveFolders(ids[0]!, null, {backend: backend(null)}), {wrapper: wrapper(store)});
    expect(noModule.result.current.fetchStatus).toBe('idle');
  });

  it('usage reads the drive endpoint', async () => {
    const {store, ids} = await signedInStore();
    const usage = jest.fn(async () => ({capacity: 100, usage: 40}));
    const b = backend({usage});
    const {result} = renderHook(() => useDriveUsage(ids[0]!, {backend: b}), {wrapper: wrapper(store)});
    await waitFor(() => expect(result.current.data).toEqual({capacity: 100, usage: 40}));
  });
});

describe('useDriveFolderMutations', () => {
  it('creates under the current parent and invalidates its list', async () => {
    const {store, ids} = await signedInStore();
    const create = jest.fn(async (name: string) => ({id: 'd9', name, parentId: 'd1'}));
    const folders = {create, list: jest.fn(async () => ({items: [], cursor: null, end: true}))};
    const b = backend({folders});
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
    const w = wrapper(store, client);
    const {result} = renderHook(() => useDriveFolderMutations(ids[0]!, {backend: b}), {wrapper: w});
    await result.current.create.mutateAsync({name: 'New', parentId: 'd1'});
    expect(create).toHaveBeenCalledWith('New', {parentId: 'd1'});
  });
});
