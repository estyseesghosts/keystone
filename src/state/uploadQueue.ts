// Upload queue (P6.6 slice 7): multi-file uploads into the current
// folder with a visible queue. Items carry their own AbortController;
// concurrency 2; per-item cancel/retry/clear-finished. The queue lives
// in a screen-level store so it survives folder navigation within the
// session. Pre-checks (size caps, free space) run at enqueue time and
// refuse with a reason instead of uploading doomed bytes.

import {useCallback, useEffect, useMemo, useReducer, useRef, useState} from 'react';

import {attachmentCapFor, formatByteLimit, kindOfMime, type Backend, type Media} from '@keystone/fedi';

import {errorText} from '#/lib/localeErrors';
import {i18n} from '#/locale/i18n';
import {msg} from '@lingui/macro';

export type UploadItemState = 'queued' | 'uploading' | 'done' | 'failed' | 'cancelled';

export interface UploadSource {
  /** `File` on web, `UploadFileRef` on native. */
  file: File | {uri: string; name: string; type: string; size?: number};
  name: string;
  size: number | null;
  mimeType: string;
}

export interface UploadItem {
  id: string;
  source: UploadSource;
  folderId: string | null;
  state: UploadItemState;
  sent: number;
  total: number | null;
  error?: string;
  attempts: number;
}

export type UploadAction =
  | {type: 'enqueue'; items: UploadItem[]}
  | {type: 'start'; id: string}
  | {type: 'progress'; id: string; sent: number; total: number | null}
  | {type: 'done'; id: string}
  | {type: 'fail'; id: string; error: string}
  | {type: 'cancel'; id: string}
  | {type: 'retry'; id: string}
  | {type: 'clearFinished'}
  | {type: 'remove'; id: string};

const CONCURRENCY = 2;

function nextId(): string {
  return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function makeUploadItem(source: UploadSource, folderId: string | null): UploadItem {
  return {id: nextId(), source, folderId, state: 'queued', sent: 0, total: null, attempts: 0};
}

export function uploadQueueReducer(state: UploadItem[], action: UploadAction): UploadItem[] {
  switch (action.type) {
    case 'enqueue':
      return [...state, ...action.items];
    case 'start':
      return state.map(i => (i.id === action.id && i.state === 'queued' ? {...i, state: 'uploading', attempts: i.attempts + 1} : i));
    case 'progress':
      return state.map(i => (i.id === action.id && i.state === 'uploading' ? {...i, sent: action.sent, total: action.total} : i));
    case 'done':
      return state.map(i => (i.id === action.id ? {...i, state: 'done', sent: i.total ?? i.sent} : i));
    case 'fail':
      return state.map(i => (i.id === action.id ? {...i, state: 'failed', error: action.error} : i));
    case 'cancel':
      return state.map(i => (i.id === action.id && (i.state === 'queued' || i.state === 'uploading') ? {...i, state: 'cancelled'} : i));
    case 'retry':
      return state.map(i =>
        i.id === action.id && (i.state === 'failed' || i.state === 'cancelled')
          ? {...i, state: 'queued', error: undefined, sent: 0, total: null}
          : i,
      );
    case 'clearFinished':
      return state.filter(i => i.state !== 'done' && i.state !== 'cancelled');
    case 'remove':
      return state.filter(i => i.id !== action.id);
  }
}

export interface UploadPrecheck {
  /** Per-kind server cap context (null = heap-bound defaults). */
  caps?: {imageBytes: number | null; videoBytes: number | null} | null;
  /** Free bytes (`capacity - usage`), or null when unknown. */
  freeBytes?: number | null;
}

/** Refuse-list for one batch: oversize (known size over the cap) or no
 * room left (known size over free space). Unknown sizes are never
 * refused here — the server decides. Pure. */
export function precheckUploads(
  files: Array<{name: string; size: number | null; mimeType: string}>,
  precheck: UploadPrecheck,
): Array<{name: string; reason: string}> {
  const refused: Array<{name: string; reason: string}> = [];
  for (const file of files) {
    if (file.size != null) {
      const kind = kindOfMime(file.mimeType);
      const cap = attachmentCapFor(kind === 'image' || kind === 'video' ? kind : 'image', precheck.caps ?? null);
      if (file.size > cap) {
        refused.push({
          name: file.name,
          reason: i18n._(msg`"${file.name}" is too large to upload (limit ${formatByteLimit(cap)}).`),
        });
        continue;
      }
      if (precheck.freeBytes != null && file.size > precheck.freeBytes) {
        refused.push({name: file.name, reason: i18n._(msg`Not enough free Drive space for "${file.name}".`)});
      }
    }
  }
  return refused;
}

export interface UploadQueue {
  items: UploadItem[];
  activeCount: number;
  failedCount: number;
  enqueue: (sources: UploadSource[], folderId: string | null, precheck?: UploadPrecheck) => {accepted: number; refused: Array<{name: string; reason: string}>};
  cancel: (id: string) => void;
  retry: (id: string) => void;
  clearFinished: () => void;
  remove: (id: string) => void;
}

/**
 * Screen-level upload queue. Pumps up to 2 uploads at a time; each item
 * gets its own AbortSignal (cancel aborts in flight). `onDone` fires per
 * completed upload (the screen inserts into the matching folder cache).
 * Queue state (not the controllers) survives remounts within the hook's
 * owner — mount it once per screen.
 */
export function useUploadQueue(
  backend: Backend | null,
  options: {
    onDone?: (item: UploadItem, media: {id: string}) => void;
    onError?: (item: UploadItem, error: unknown) => string;
  } = {},
): UploadQueue {
  const [items, dispatch] = useReducer(uploadQueueReducer, [] as UploadItem[]);
  const ctrls = useRef(new Map<string, AbortController>());
  const claimed = useRef(new Set<string>());
  const running = useRef(0);
  const backendRef = useRef(backend);
  backendRef.current = backend;
  const optsRef = useRef(options);
  optsRef.current = options;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const pump = useCallback(() => {
    const b = backendRef.current;
    if (!b?.uploadMedia) return;
    while (running.current < CONCURRENCY) {
      // Claim synchronously: progress dispatches re-trigger effects before
      // the `start` reducer lands, and a second pump pass must not pick an
      // item that is already starting.
      const next = itemsRef.current.find(i => i.state === 'queued' && !claimed.current.has(i.id));
      if (!next) return;
      claimed.current.add(next.id);
      running.current++;
      void (async () => {
        const ctrl = new AbortController();
        ctrls.current.set(next.id, ctrl);
        dispatch({type: 'start', id: next.id});
        try {
          const media = await b.uploadMedia(next.source.file as never, {
            ...(next.folderId ? {folderId: next.folderId} : {}),
            signal: ctrl.signal,
            onProgress: (sent: number, total: number | null) => {
              dispatch({type: 'progress', id: next.id, sent, total});
            },
          });
          ctrls.current.delete(next.id);
          dispatch({type: 'done', id: next.id});
          optsRef.current.onDone?.(next, media);
        } catch (err) {
          ctrls.current.delete(next.id);
          if ((err as {name?: string})?.name === 'AbortError' || ctrl.signal.aborted) {
            dispatch({type: 'cancel', id: next.id});
          } else {
            const message =
              optsRef.current.onError?.(next, err) ?? errorText(i18n, err, i18n._(msg`Upload failed.`));
            dispatch({type: 'fail', id: next.id, error: message});
          }
        } finally {
          claimed.current.delete(next.id);
          running.current--;
          pump();
        }
      })();
    }
  }, []);

  useEffect(() => {
    pump();
  }, [items, pump]);

  return useMemo<UploadQueue>(() => {
    const activeCount = items.filter(i => i.state === 'queued' || i.state === 'uploading').length;
    const failedCount = items.filter(i => i.state === 'failed').length;
    return {
      items,
      activeCount,
      failedCount,
      enqueue: (sources, folderId, precheck = {}) => {
        const refused = precheckUploads(
          sources.map(s => ({name: s.name, size: s.size, mimeType: s.mimeType})),
          precheck,
        );
        const refusedNames = new Set(refused.map(r => r.name));
        const accepted = sources.filter(s => !refusedNames.has(s.name)).map(s => makeUploadItem(s, folderId));
        if (accepted.length > 0) dispatch({type: 'enqueue', items: accepted});
        return {accepted: accepted.length, refused};
      },
      cancel: id => {
        ctrls.current.get(id)?.abort();
        ctrls.current.delete(id);
        dispatch({type: 'cancel', id});
      },
      retry: id => {
        dispatch({type: 'retry', id});
      },
      clearFinished: () => dispatch({type: 'clearFinished'}),
      remove: id => {
        ctrls.current.get(id)?.abort();
        ctrls.current.delete(id);
        dispatch({type: 'remove', id});
      },
    };
  }, [items]);
}
