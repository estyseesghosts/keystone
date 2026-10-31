// Pure Drive/Clips helpers (P6.6 slice 1): concurrency pool, folder
// delete ordering, mosaic collection. No network, no React.

import type {Post} from "./models";

/** One pool result per input item, in input order. */
export interface PoolResult<T> {
  item: T;
  ok: boolean;
  error?: unknown;
}

/** Run `worker` over `items` with at most `concurrency` in flight.
 * Results keep input order; one item's throw becomes `{ok: false}`
 * (never rejects the pool — DC-8 requires a per-item report). Pure
 * apart from the worker itself. */
export async function runPool<T>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<unknown>,
  opts: {concurrency: number},
): Promise<Array<PoolResult<T>>> {
  const concurrency = Math.max(1, Math.floor(opts.concurrency));
  const out: Array<PoolResult<T>> = new Array(items.length);
  let next = 0;
  async function pump(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        await worker(items[i] as T, i);
        out[i] = {item: items[i] as T, ok: true};
      } catch (error) {
        out[i] = {item: items[i] as T, ok: false, error};
      }
    }
  }
  const pumps: Array<Promise<void>> = [];
  for (let k = 0; k < Math.min(concurrency, items.length); k++) pumps.push(pump());
  await Promise.all(pumps);
  return out;
}

/** One folder-tree entry for delete planning. */
export interface FolderNode {
  id: string;
  /** File ids directly inside. */
  files: string[];
  /** Immediate subfolders (recursive). */
  children: FolderNode[];
}

/** Depth-first delete order for a non-empty folder (DC-9): files first,
 * then each child subtree, then the folder itself. The plan is a list
 * of steps so the UI can count, confirm, and abort over the limit.
 * Pure. */
export type DeleteStep = {kind: "file"; id: string} | {kind: "folder"; id: string};

export function planFolderDelete(tree: FolderNode): DeleteStep[] {
  const steps: DeleteStep[] = [];
  const walk = (node: FolderNode): void => {
    for (const fileId of node.files) steps.push({kind: "file", id: fileId});
    for (const child of node.children) walk(child);
    steps.push({kind: "folder", id: node.id});
  };
  walk(tree);
  return steps;
}

/** Mosaic source: up to `max` image URLs from posts in order (newest
 * first — `clips/notes` exposes no add order, DC-4). Videos and
 * non-image media are skipped; sensitive images stay with their flag
 * so the thumb can blur them (DC-12). Pure. */
export interface MosaicImage {
  url: string;
  isSensitive: boolean;
}

export function collectMosaic(posts: readonly Post[], max = 4): MosaicImage[] {
  const out: MosaicImage[] = [];
  for (const post of posts) {
    if (out.length >= max) break;
    for (const file of post.media ?? []) {
      if (out.length >= max) break;
      if (file.kind !== "image") continue;
      if (typeof file.url !== "string" || file.url === "") continue;
      if (out.some(m => m.url === file.url)) continue;
      out.push({url: file.url, isSensitive: file.isSensitive === true});
    }
  }
  return out;
}
