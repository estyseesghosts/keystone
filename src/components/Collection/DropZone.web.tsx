// DropZone.web (P6.6 slice 8 wires it; slice 2 ships the mechanism):
// HTML5 DnD over the wrapped DOM node. OS files → `onFiles`; collection
// items → `onItems(keys, targetKey)`; text/links are ignored. The overlay
// names the drop target folder.

import {useRef, useState, type ReactNode} from 'react';
import {Platform, View} from 'react-native';
import {msg} from '@lingui/macro';

import {atoms} from '#/alf/atoms';
import {Body} from '#/alf/typography';
import {i18n} from '#/locale/i18n';

import {getActiveDragKeys} from './Tile';

export interface DropZoneWebProps {
  children: ReactNode;
  /** Current target folder id (null = root) for the overlay + files. */
  targetKey: string | null;
  targetName: string;
  /** Item keys currently dragged (from `draggable` tiles/rows). */
  draggedKeys: () => string[];
  onFiles: (files: File[], targetKey: string | null) => void;
  onItems: (keys: string[], targetKey: string | null) => void;
  testID?: string;
}

function hasFiles(e: {dataTransfer?: {types?: ArrayLike<string>; files?: ArrayLike<unknown>} | null}): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true;
  return (e.dataTransfer?.files?.length ?? 0) > 0;
}

export interface DropTargetOptions {
  /** Folder the drop lands in (null = root). */
  targetKey: string | null;
  /** Keys of the dragged items (selection-aware; falls back to the
   * in-flight drag when set). */
  getDraggedKeys: () => string[];
  /** False → `dropEffect: 'none'` on hover and the drop is ignored. */
  isValidTarget: (targetKey: string | null, keys: string[]) => boolean;
  onFiles: (files: File[], targetKey: string | null) => void;
  onItems: (keys: string[], targetKey: string | null) => void;
  onEnter?: (targetKey: string | null) => void;
  onLeave?: (targetKey: string | null) => void;
}

type DomDragEvent = {
  preventDefault(): void;
  stopPropagation?: () => void;
  dataTransfer?: {
    types?: ArrayLike<string>;
    files?: ArrayLike<File>;
    getData?: (t: string) => string;
    dropEffect?: string;
  } | null;
};

/**
 * Drop-target DOM props (P6.6 slice 8): folder tiles and breadcrumb
 * crumbs spread these onto their view. Files and our key payload land
 * via `onFiles`/`onItems`; text/links are ignored. Invalid targets get
 * no drop cursor and ignore the drop (the server guards too).
 */
export function dropTargetDomProps(opts: DropTargetOptions): Record<string, unknown> {
  const draggedNow = (): string[] => getActiveDragKeys() ?? opts.getDraggedKeys();
  const validNow = (): boolean => {
    try {
      return opts.isValidTarget(opts.targetKey, draggedNow());
    } catch {
      return true;
    }
  };
  return {
    onDragEnter: (e: DomDragEvent) => {
      e.preventDefault();
      opts.onEnter?.(opts.targetKey);
    },
    onDragOver: (e: DomDragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = validNow() ? 'copy' : 'none';
    },
    onDragLeave: (e: DomDragEvent) => {
      e.preventDefault();
      opts.onLeave?.(opts.targetKey);
    },
    onDrop: (e: DomDragEvent) => {
      e.preventDefault();
      e.stopPropagation?.();
      const dt = e.dataTransfer;
      if (!dt) return;
      if (hasFiles({dataTransfer: dt as never})) {
        const files: File[] = [];
        const list = dt.files;
        if (list) for (let i = 0; i < list.length; i++) files.push(list[i]!);
        if (files.length > 0) opts.onFiles(files, opts.targetKey);
        return;
      }
      const raw = dt.getData?.('application/x-keystone-keys');
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.every(k => typeof k === 'string') && parsed.length > 0) {
            const keys = parsed as string[];
            if (opts.isValidTarget(opts.targetKey, keys)) opts.onItems(keys, opts.targetKey);
            return;
          }
        } catch {
          // Not our payload: ignore (text/links never move).
        }
        return;
      }
      const fallback = draggedNow();
      if (fallback.length > 0 && opts.isValidTarget(opts.targetKey, fallback)) {
        opts.onItems(fallback, opts.targetKey);
      }
    },
  };
}

export function DropZone({
  children,
  targetKey,
  targetName,
  draggedKeys,
  onFiles,
  onItems,
  testID,
}: DropZoneWebProps) {
  const [over, setOver] = useState(false);
  const counter = useRef(0);
  if (Platform.OS !== 'web') return <>{children}</>;
  const domProps: Record<string, unknown> = {
    onDragEnter: (e: {preventDefault(): void}) => {
      e.preventDefault();
      counter.current++;
      setOver(true);
    },
    onDragOver: (e: {preventDefault(): void; dataTransfer?: {dropEffect?: string} | null}) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: {preventDefault(): void}) => {
      e.preventDefault();
      counter.current = Math.max(0, counter.current - 1);
      if (counter.current === 0) setOver(false);
    },
    onDrop: (e: {
      preventDefault(): void;
      dataTransfer?: {files?: ArrayLike<File>; getData?: (t: string) => string} | null;
    }) => {
      e.preventDefault();
      counter.current = 0;
      setOver(false);
      const dt = e.dataTransfer;
      if (!dt) return;
      if (hasFiles({dataTransfer: dt as never})) {
        const files: File[] = [];
        const list = dt.files;
        if (list) for (let i = 0; i < list.length; i++) files.push(list[i]!);
        if (files.length > 0) onFiles(files, targetKey);
        return;
      }
      const keys = dt.getData?.('application/x-keystone-keys');
      if (keys) {
        try {
          const parsed: unknown = JSON.parse(keys);
          if (Array.isArray(parsed) && parsed.every(k => typeof k === 'string')) {
            if (parsed.length > 0) onItems(parsed as string[], targetKey);
          }
        } catch {
          // Not our payload: ignore (text/links never move).
        }
        return;
      }
      const fallback = draggedKeys();
      if (fallback.length > 0) onItems(fallback, targetKey);
    },
  };
  return (
    <View
      style={atoms.flex1}
      testID={testID}
      // RN-web passes unknown props to the DOM node.
      {...domProps}>
      {children}
      {over ? (
        <View testID={testID ? `${testID}-overlay` : undefined}>
          <Body>{i18n._(msg`Drop to upload to ${targetName}`)}</Body>
        </View>
      ) : null}
    </View>
  );
}
