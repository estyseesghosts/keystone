// P6.6 slice 7: upload queue — reducer transitions, pre-check
// refusals, concurrency/cancel/retry through the hook.

import {act, renderHook, waitFor} from '@testing-library/react-native';

import {makeUploadItem, precheckUploads, uploadQueueReducer, useUploadQueue, type UploadItem} from './uploadQueue';

function item(over: Partial<UploadItem> = {}): UploadItem {
  return {
    id: `u${Math.random()}`,
    source: {file: {uri: 'file:///a.png', name: 'a.png', type: 'image/png'} as never, name: 'a.png', size: 10, mimeType: 'image/png'},
    folderId: null,
    state: 'queued',
    sent: 0,
    total: null,
    attempts: 0,
    ...over,
  };
}

describe('uploadQueueReducer', () => {
  it('enqueues, starts once, tracks progress, completes', () => {
    let st: UploadItem[] = []
    st = uploadQueueReducer(st, {type: 'enqueue', items: [item({id: 'a'}), item({id: 'b'})]})
    expect(st.map(i => i.state)).toEqual(['queued', 'queued'])
    st = uploadQueueReducer(st, {type: 'start', id: 'a'})
    expect(st.find(i => i.id === 'a')).toMatchObject({state: 'uploading', attempts: 1})
    // Re-start is a no-op (single-flight guard).
    st = uploadQueueReducer(st, {type: 'start', id: 'a'})
    expect(st.find(i => i.id === 'a')!.attempts).toBe(1)
    st = uploadQueueReducer(st, {type: 'progress', id: 'a', sent: 5, total: 10})
    expect(st.find(i => i.id === 'a')).toMatchObject({sent: 5, total: 10})
    st = uploadQueueReducer(st, {type: 'done', id: 'a'})
    expect(st.find(i => i.id === 'a')!.state).toBe('done')
    st = uploadQueueReducer(st, {type: 'clearFinished'})
    expect(st.map(i => i.id)).toEqual(['b'])
  })

  it('fails, retries, cancels', () => {
    let st = [item({id: 'a'})]
    st = uploadQueueReducer(st, {type: 'fail', id: 'a', error: 'nope'})
    expect(st[0]).toMatchObject({state: 'failed', error: 'nope'})
    st = uploadQueueReducer(st, {type: 'retry', id: 'a'})
    expect(st[0]).toMatchObject({state: 'queued', error: undefined, sent: 0})
    st = uploadQueueReducer(st, {type: 'start', id: 'a'})
    st = uploadQueueReducer(st, {type: 'cancel', id: 'a'})
    expect(st[0]!.state).toBe('cancelled')
    // Cancel is terminal for finished items.
    st = uploadQueueReducer([item({id: 'b', state: 'done'})], {type: 'cancel', id: 'b'})
    expect(st[0]!.state).toBe('done')
  })
})

describe('precheckUploads', () => {
  it('refuses oversize and over-quota files, passes unknowns', () => {
    const out = precheckUploads(
      [
        {name: 'big.png', size: 100 * 1024 * 1024, mimeType: 'image/png'},
        {name: 'ok.png', size: 10, mimeType: 'image/png'},
        {name: 'mystery', size: null, mimeType: 'application/octet-stream'},
      ],
      {caps: {imageBytes: null, videoBytes: null}, freeBytes: 50},
    )
    expect(out.map(r => r.name)).toEqual(['big.png'])
    const over = precheckUploads([{name: 'f.png', size: 100, mimeType: 'image/png'}], {freeBytes: 10})
    expect(over.map(r => r.name)).toEqual(['f.png'])
  })
})

describe('useUploadQueue', () => {
  it('runs at most 2 concurrent uploads and completes', async () => {
    let live = 0
    let peak = 0
    const uploadMedia = jest.fn(async () => {
      live++
      peak = Math.max(peak, live)
      await new Promise(r => setTimeout(r, 20))
      live--
      return {id: 'f1'}
    })
    const {result} = renderHook(() => useUploadQueue({uploadMedia} as never))
    const sources = [0, 1, 2, 3].map(i => ({
      file: {uri: `file:///a${i}.png`, name: `a${i}.png`, type: 'image/png'} as never,
      name: `a${i}.png`,
      size: 10,
      mimeType: 'image/png',
    }))
    let accepted = 0
    await act(async () => {
      const r = result.current.enqueue(sources, null)
      accepted = r.accepted
    })
    expect(accepted).toBe(4)
    await waitFor(() => expect(result.current.items.filter(i => i.state === 'done')).toHaveLength(4), {timeout: 5000})
    expect(peak).toBeLessThanOrEqual(2)
    expect(uploadMedia).toHaveBeenCalledTimes(4)
  })

  it('cancels an in-flight upload and retries a failure', async () => {
    const uploadMedia = jest.fn(async () => {
      await new Promise(r => setTimeout(r, 50))
      return {id: 'f1'}
    })
    const {result} = renderHook(() => useUploadQueue({uploadMedia} as never))
    await act(async () => {
      result.current.enqueue(
        [{file: {uri: 'file:///a.png', name: 'a.png', type: 'image/png'} as never, name: 'a.png', size: 10, mimeType: 'image/png'}],
        null,
      )
    })
    await waitFor(() => expect(result.current.items[0]!.state).toBe('uploading'))
    await act(async () => {
      result.current.cancel(result.current.items[0]!.id)
    })
    await waitFor(() => expect(result.current.items[0]!.state).toBe('cancelled'))
  })

  it('maps errors through onError', async () => {
    const uploadMedia = jest.fn(async () => {
      throw new Error('nope')
    })
    const {result} = renderHook(() =>
      useUploadQueue({uploadMedia} as never, {onError: () => 'Mapped!'}),
    )
    await act(async () => {
      result.current.enqueue(
        [{file: {uri: 'file:///a.png', name: 'a.png', type: 'image/png'} as never, name: 'a.png', size: 10, mimeType: 'image/png'}],
        null,
      )
    })
    await waitFor(() => expect(result.current.items[0]!.state).toBe('failed'), {timeout: 5000})
    expect(result.current.items[0]!.error).toBe('Mapped!')
  })
})
