// My Uploads on the collection kit (P6.6 slice 5): folders, files,
// breadcrumbs (`/drive/:folderId?`, DC-13), usage, sort, filter,
// detail panel, single-item actions. Multi-select, upload queue and DnD
// land in slices 6–8.

import {useCallback, useEffect, useMemo, useReducer, useRef, useState} from 'react';
import {Platform, ScrollView, StyleSheet, View} from 'react-native';
import {useNavigation, useRoute, type NavigationProp, type RouteProp} from '@react-navigation/native';
import {msg} from '@lingui/macro';

import {
  runPool,
  type Backend,
  type Cursor,
  type DriveFolder,
  type DriveSort,
  type Media,
  type Page,
} from '@keystone/fedi';

import {atoms} from '#/alf/atoms';
import {useTheme} from '#/alf/index';
import {Body, Caption} from '#/alf/typography';
import {Button} from '#/components/Button';
import {Dialog} from '#/components/Dialog';
import {Loader} from '#/components/Loader';
import {Menu} from '#/components/Menu';
import {MoreIcon} from '#/components/icons';
import {useBreakpoints} from '#/alf/breakpoints';
import {useDataSaver} from '#/state/appearance';
import {pickMedia} from '#/components/Composer/pickMedia';
import type {UploadableFile} from '#/state/queries/composer';
import {formatByteLimit} from '#/state/queries/composer';
import {errorText} from '#/lib/localeErrors';
import {showToast} from '#/lib/toast';
import {i18n} from '#/locale/i18n';
import type {RootParamList} from '#/routes';
import {useActiveBackend} from '#/screens/HomeFeed';

import {CollectionScreen} from '#/components/Collection/CollectionScreen';
import {Toolbar} from '#/components/Collection/Toolbar';
import {SelectionBar} from '#/components/Collection/SelectionBar';
import {initSelection, isSelected, selectionReducer} from '#/components/Collection/useSelection';
import {fileItem, folderItem} from '#/components/Drive/tiles';
import {Breadcrumbs} from '#/components/Drive/Breadcrumbs';
import {UsageBar} from '#/components/Drive/UsageBar';
import {FileDetailPanel} from '#/components/Drive/FileDetailPanel';
import {FolderDialog} from '#/components/Drive/FolderDialog';
import {MoveToDialog} from '#/components/Drive/MoveToDialog';
import {
  useDriveFileMutations,
  useDriveFiles,
  useDriveFolder,
  useDriveFolderMutations,
  useDriveFolders,
  useDriveUsage,
  useInvalidateDrive,
} from '#/state/queries/drive';
import type {CollectionItem} from '#/components/Collection/types';

import {UploadPanel} from './Drive/upload';

type SortKey = 'name-asc' | 'name-desc' | 'date-desc' | 'date-asc' | 'size-desc' | 'size-asc';

const SORT_OPTIONS: Array<{key: SortKey; sort: DriveSort; label: string}> = [
  {key: 'name-asc', sort: '+name', label: 'Name ↑'},
  {key: 'name-desc', sort: '-name', label: 'Name ↓'},
  {key: 'date-desc', sort: '-createdAt', label: 'Date ↓'},
  {key: 'date-asc', sort: '+createdAt', label: 'Date ↑'},
  {key: 'size-desc', sort: '-size', label: 'Size ↓'},
  {key: 'size-asc', sort: '+size', label: 'Size ↑'},
];

interface WalkTree {
  folderId: string | null;
  folders: DriveFolder[];
  files: Media[];
  truncated: boolean;
}

/** Depth-first walk of a folder subtree (DC-9): every listing paged to
 * the end (single pages lie about emptiness), aborting past `budget`. */
export async function walkFolderTree(
  backend: NonNullable<Backend['drive']>,
  rootId: string | null,
  budget = 1000,
): Promise<WalkTree> {
  const folders: DriveFolder[] = [];
  const files: Media[] = [];
  let truncated = false;
  let count = 0;

  async function listAllFolders(parentId: string | null): Promise<DriveFolder[]> {
    const out: DriveFolder[] = [];
    let cursor: Cursor | null = null;
    for (;;) {
      const page: Page<DriveFolder> | null = backend.folders
        ? await backend.folders.list({parentId, limit: 100, ...(cursor ? {cursor} : {})})
        : null;
      if (!page) break;
      out.push(...page.items);
      if (page.end || page.cursor == null || out.length > budget) break;
      cursor = page.cursor;
    }
    return out;
  }

  async function listAllFiles(folderId: string | null): Promise<Media[]> {
    const out: Media[] = [];
    let cursor: Cursor | null = null;
    for (;;) {
      const page = await backend.files({folderId: folderId ?? undefined, limit: 100, ...(cursor ? {cursor} : {})});
      out.push(...page.items);
      if (page.end || page.cursor == null || out.length > budget) break;
      cursor = page.cursor;
    }
    return out;
  }

  const queue: Array<{id: string | null}> = [{id: rootId}];
  const seen = new Set<string | null>([rootId]);
  while (queue.length > 0) {
    const {id} = queue.shift()!;
    const [kids, docs] = await Promise.all([listAllFolders(id), listAllFiles(id)]);
    for (const doc of docs) {
      if (count++ >= budget) {
        truncated = true;
        return {folderId: rootId, folders, files, truncated};
      }
      files.push(doc);
    }
    for (const kid of kids) {
      if (count++ >= budget) {
        truncated = true;
        return {folderId: rootId, folders, files, truncated};
      }
      if (seen.has(kid.id)) continue;
      seen.add(kid.id);
      folders.push(kid);
      queue.push({id: kid.id});
    }
  }
  return {folderId: rootId, folders, files, truncated};
}

export function DriveScreen() {
  const theme = useTheme();
  const {session, backend} = useActiveBackend();
  const navigation = useNavigation<NavigationProp<RootParamList>>();
  const route = useRoute<RouteProp<RootParamList, 'Drive'>>();
  const folderId = route.params?.folderId ?? null;
  const sessionId = session?.id ?? null;
  const {gtTablet} = useBreakpoints();
  const dataSaver = useDataSaver();
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date-desc');
  const sort = SORT_OPTIONS.find(o => o.key === sortKey)?.sort;
  const folders = useDriveFolders(sessionId, folderId, backend ? {backend} : {});
  const files = useDriveFiles(sessionId, folderId, backend ? {backend, ...(sort ? {sort} : {})} : {});
  const detail = useDriveFolder(sessionId, folderId, backend ? {backend} : {});
  const usage = useDriveUsage(sessionId, backend ? {backend} : {});
  const invalidate = useInvalidateDrive();
  const folderMutations = useDriveFolderMutations(sessionId, backend ? {backend} : {});
  const fileMutations = useDriveFileMutations(sessionId, backend ? {backend} : {});
  const [detailFile, setDetailFile] = useState<Media | null>(null);
  const [folderDialog, setFolderDialog] = useState<{folder: DriveFolder | null} | null>(null);
  const [moveTarget, setMoveTarget] = useState<
    {file: Media} | {folder: DriveFolder} | {bulk: {files: Media[]; folders: DriveFolder[]}}
  | null
  >(null);
  const [moveDescendants, setMoveDescendants] = useState<string[]>([]);
  const modRef = useRef({ctrl: false, meta: false, shift: false});
  const lastTap = useRef<{key: string; at: number} | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<{folder: DriveFolder; walk: WalkTree} | null>(null);
  const [deleteFile, setDeleteFile] = useState<Media | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  // Single-file upload (slice 7 owns the queue; this keeps today's flow).
  const [staged, setStaged] = useState<UploadableFile | null>(null);
  const [uploadComment, setUploadComment] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  const sortSupported = backend?.drive?.isSortSupported?.() !== false;
  const canUseDrive = backend?.drive != null;

  const folderItems = (folders.data?.pages ?? []).flatMap(p => p.items);
  const fileItems = (files.data?.pages ?? []).flatMap(p => p.items);
  const [sel, dispatchSel] = useReducer(selectionReducer, undefined, () => initSelection([]));
  const [deleteBulk, setDeleteBulk] = useState<{files: Media[]; folders: DriveFolder[]; walks: Map<string, WalkTree>} | null>(null);
  const [failedOps, setFailedOps] = useState<Array<{kind: 'file' | 'folder'; id: string; name: string; error: unknown}> | null>(null);
  const [lastBulk, setLastBulk] = useState<{
    kind: 'move' | 'delete' | 'sensitive';
    files: Media[];
    folders: DriveFolder[];
    targetId?: string | null;
    value?: boolean;
  } | null>(null);
  const selectedFiles = useMemo(
    () => fileItems.filter(f => sel.selected.includes(f.id)),
    [fileItems, sel.selected],
  );
  const selectedFolders = useMemo(
    () => folderItems.filter(f => sel.selected.includes(f.id)),
    [folderItems, sel.selected],
  );
  const selRef = useRef(sel);
  selRef.current = sel;
  const q = filter.trim().toLowerCase();
  const visibleFolders = q ? folderItems.filter(f => f.name.toLowerCase().includes(q)) : folderItems;
  const visibleFiles = q ? fileItems.filter(f => f.name.toLowerCase().includes(q)) : fileItems;

  const openBulkDelete = useCallback(() => {
    if (selRef.current.selected.length === 0) return;
    void (async () => {
      if (!backend?.drive || !sessionId) return;
      setBusy(true);
      try {
        const ids = new Set(selRef.current.selected);
        const bfiles = fileItems.filter(f => ids.has(f.id));
        const bfolders = folderItems.filter(f => ids.has(f.id));
        let budget = 1000;
        const walks = new Map<string, WalkTree>();
        for (const folder of bfolders) {
          const walk = await walkFolderTree(backend.drive, folder.id, budget);
          budget -= walk.files.length + walk.folders.length;
          if (walk.truncated || budget < 0) {
            setActionError(i18n._(msg`That selection is too large to delete (over 1000 items).`));
            return;
          }
          walks.set(folder.id, walk);
        }
        setDeleteBulk({files: bfiles, folders: bfolders, walks});
      } catch (err) {
        setActionError(errorText(i18n, err, i18n._(msg`Could not inspect the selection.`)));
      } finally {
        setBusy(false);
      }
    })();
  }, [backend, sessionId, fileItems, folderItems]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Control') modRef.current.ctrl = true;
      if (e.key === 'Meta') modRef.current.meta = true;
      if (e.key === 'Shift') modRef.current.shift = true;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable === true);
      if (e.key === 'Escape') {
        dispatchSel({type: 'clear'});
        return;
      }
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        dispatchSel({type: 'all'});
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selRef.current.selected.length > 0) {
        e.preventDefault();
        openBulkDelete();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Control') modRef.current.ctrl = false;
      if (e.key === 'Meta') modRef.current.meta = false;
      if (e.key === 'Shift') modRef.current.shift = false;
    };
    document.addEventListener('keydown', down);
    document.addEventListener('keyup', up);
    return () => {
      document.removeEventListener('keydown', down);
      document.removeEventListener('keyup', up);
    };
  }, [openBulkDelete]);

  const crumbs = useMemo(() => {
    const trail: Array<{key: string | null; label: string}> = [
      {key: null, label: i18n._(msg`My Uploads`)},
    ];
    for (const f of detail.data?.path ?? []) trail.push({key: f.id, label: f.name});
    return trail;
  }, [detail.data]);

  const openFolder = (id: string | null) => {
    navigation.navigate('Drive', id == null ? {} : {folderId: id});
  };

  const isWeb = Platform.OS === 'web';
  // Shown checkboxes: native selection mode, or anything selected on web.
  const selectMode = sel.mode || (isWeb && sel.selected.length > 0);

  const openItem = (key: string) => {
    const folder = folderItems.find(f => f.id === key);
    if (folder) {
      openFolder(folder.id);
      return;
    }
    const file = fileItems.find(f => f.id === key);
    if (file) setDetailFile(file);
  };

  /** Tap routing: native mode toggles (the tile handles it); web
   * single-click selects, ctrl/cmd toggles, shift ranges, double-click
   * opens. */
  const handlePress = (key: string) => {
    if (!isWeb) {
      openItem(key);
      return;
    }
    const mods = modRef.current;
    if (mods.ctrl || mods.meta) {
      dispatchSel({type: 'toggle', key});
      return;
    }
    if (mods.shift) {
      dispatchSel({type: 'range', key});
      return;
    }
    const now = Date.now();
    const last = lastTap.current;
    if (last && last.key === key && now - last.at < 400) {
      lastTap.current = null;
      openItem(key);
      return;
    }
    lastTap.current = {key, at: now};
    dispatchSel({type: 'click', key});
  };

  useEffect(() => {
    setDetailFile(null);
    setFilter('');
    dispatchSel({type: 'clear'});
  }, [folderId]);

  const allKeys = useMemo(
    () => [...folderItems.map(f => f.id), ...fileItems.map(f => f.id)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [folders.data, files.data],
  );
  useEffect(() => {
    dispatchSel({type: 'setOrder', order: allKeys});
  }, [allKeys]);

  if (!sessionId || !backend) {
    return (
      <View style={atoms.flex1} testID="drive-screen">
        <CollectionScreen
          screen="drive"
          title={i18n._(msg`My Uploads`)}
          items={[]}
          render={{selected: () => false, selectionMode: false, onOpen: () => {}, onToggle: () => {}}}
          signedOut
          signedOutMessage={i18n._(msg`Sign in to see your drive.`)}
          testID="drive-collection"
        />
      </View>
    );
  }

  if (!canUseDrive) {
    return (
      <View style={atoms.flex1} testID="drive-screen">
        <CollectionScreen
          screen="drive"
          title={i18n._(msg`My Uploads`)}
          items={[]}
          render={{selected: () => false, selectionMode: false, onOpen: () => {}, onToggle: () => {}}}
          session={session}
          unsupportedMessage={i18n._(msg`Drive is not available on this server.`)}
          testID="drive-collection"
        />
      </View>
    );
  }

  const items: CollectionItem[] = [
    ...visibleFolders.map(f => ({...folderItem(f), detail: undefined})),
    ...visibleFiles.map(f => fileItem(f, f.createdAt)),
  ];

  const chooseFile = async () => {
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const result = await pickMedia({limit: 1});
      if (result.kind === 'denied') {
        setUploadError(
          result.canAskAgain
            ? i18n._(msg`Media library access was denied. Allow access to pick a file.`)
            : i18n._(msg`Media library access was denied. Enable it in the system settings to pick a file.`),
        );
        return;
      }
      if (result.kind === 'cancelled') return;
      if (result.rejected.length > 0 || result.files.length === 0) {
        const rejected = result.rejected[0];
        setUploadError(
          rejected
            ? i18n._(msg`"${rejected.name}" is too large to upload (limit ${formatByteLimit(rejected.limit)}).`)
            : i18n._(msg`That file could not be read.`),
        );
        return;
      }
      setStaged(result.files[0]!);
    } catch (err) {
      setUploadError(errorText(i18n, err as Error, i18n._(msg`Could not open the file picker.`)));
    }
  };

  const uploadStaged = async () => {
    if (!backend || !staged || uploading) return;
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const comment = uploadComment.trim();
      const media = await backend.uploadMedia(staged.file, {
        ...(folderId ? {folderId} : {}),
        ...(comment ? {comment} : {}),
      });
      setUploadSuccess(i18n._(msg`Uploaded “${media.name}”.`));
      setStaged(null);
      setUploadComment('');
      invalidate.folder(sessionId, folderId);
    } catch (err) {
      setUploadError(errorText(i18n, err as Error, i18n._(msg`Could not upload the file.`)));
    } finally {
      setUploading(false);
    }
  };

  const askDeleteFolder = async (folder: DriveFolder) => {
    if (!backend?.drive || !sessionId) return;
    setBusy(true);
    setActionError(null);
    try {
      const walk = await walkFolderTree(backend.drive, folder.id);
      if (walk.truncated) {
        setActionError(i18n._(msg`That folder is too large to delete here (over 1000 items).`));
        return;
      }
      setDeleteFolder({folder, walk});
    } catch (err) {
      setActionError(errorText(i18n, err, i18n._(msg`Could not inspect the folder.`)));
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteFolder = async () => {
    if (!backend?.drive || !deleteFolder || !sessionId) return;
    setBusy(true);
    try {
      // Files first, pooled with a per-item report (DC-8): a failed file
      // aborts the delete instead of leaving a half-deleted folder.
      const results = await runPool(deleteFolder.walk.files, item => backend.drive!.deleteFile(item.id), {
        concurrency: 4,
      });
      const failed = results.filter(r => !r.ok);
      if (failed.length > 0) {
        const names = failed
          .slice(0, 5)
          .map(r => deleteFolder.walk.files.find(f => f.id === r.item.id)?.name ?? r.item.id)
          .join(', ');
        throw new Error(i18n._(msg`Could not delete ${failed.length} file(s): ${names}`));
      }
      for (const sub of [...deleteFolder.walk.folders].reverse()) {
        await backend.drive.folders!.delete(sub.id);
      }
      await backend.drive.folders!.delete(deleteFolder.folder.id);
      setDeleteFolder(null);
      invalidate.folder(sessionId, folderId);
    } catch (err) {
      setActionError(errorText(i18n, err, i18n._(msg`Could not delete the folder.`)));
    } finally {
      setBusy(false);
    }
  };

  const openMoveTarget = async (target: {file: Media} | {folder: DriveFolder} | {bulk: {files: Media[]; folders: DriveFolder[]}}) => {
    setMoveTarget(target);
    if (backend?.drive && ('folder' in target || 'bulk' in target)) {
      try {
        const roots = 'folder' in target ? [target.folder] : target.bulk.folders;
        const ids = new Set<string>();
        for (const root of roots) {
          ids.add(root.id);
          const walk = await walkFolderTree(backend.drive, root.id);
          for (const sub of walk.folders) ids.add(sub.id);
        }
        setMoveDescendants([...ids]);
      } catch {
        setMoveDescendants('folder' in target ? [target.folder.id] : target.bulk.folders.map(f => f.id));
      }
    } else {
      setMoveDescendants([]);
    }
  };

  const doMove = async (targetId: string | null) => {
    if (!sessionId) return;
    if (moveTarget && 'folder' in moveTarget) {
      await folderMutations.move.mutateAsync({id: moveTarget.folder.id, parentId: targetId});
      invalidate.folder(sessionId, folderId);
      invalidate.folder(sessionId, targetId);
    } else if (moveTarget && 'file' in moveTarget) {
      await fileMutations.patch.mutateAsync({
        id: moveTarget.file.id,
        folderId,
        patch: {folderId: targetId},
      });
    } else if (moveTarget && 'bulk' in moveTarget) {
      await doBulkMove(targetId, moveTarget.bulk.files, moveTarget.bulk.folders);
    }
    setMoveTarget(null);
  };

  /** Bulk move: `moveMany` in chunks of 100 where supported, else a
   * per-file update pool; folders move one by one (no-op targets
   * skipped). Partial failures open the retry dialog (never silent). */
  const doBulkMove = async (targetId: string | null, files: Media[], folders: DriveFolder[]) => {
    if (!backend?.drive || !sessionId) return;
    setBusy(true);
    const failed: Array<{kind: 'file' | 'folder'; id: string; name: string; error: unknown}> = [];
    try {
      const movableFiles = files.filter(f => (f.folderId ?? null) !== targetId);
      if (movableFiles.length > 0) {
        if (backend.drive.isMoveBulkSupported?.() !== false) {
          for (let i = 0; i < movableFiles.length; i += 100) {
            const chunk = movableFiles.slice(i, i + 100);
            try {
              await backend.drive.moveMany(
                chunk.map(f => f.id),
                targetId,
              );
            } catch (err) {
              for (const f of chunk) failed.push({kind: 'file', id: f.id, name: f.name, error: err});
            }
          }
        } else {
          const results = await runPool(movableFiles, f => backend.drive!.updateFile(f.id, {folderId: targetId}), {
            concurrency: 4,
          });
          results.forEach((r, i) => {
            if (!r.ok) failed.push({kind: 'file', id: movableFiles[i]!.id, name: movableFiles[i]!.name, error: r.error});
          });
        }
      }
      for (const folder of folders) {
        // The Move-to dialog disables self/descendant targets; a no-op
        // parent is skipped here (the server would accept it harmlessly).
        if ((folder.parentId ?? null) === targetId) continue;
        try {
          await backend.drive.folders!.update(folder.id, {parentId: targetId});
        } catch (err) {
          failed.push({kind: 'folder', id: folder.id, name: folder.name, error: err});
        }
      }
      invalidate.folder(sessionId, folderId);
      invalidate.folder(sessionId, targetId);
      finishBulk('move', files, folders, failed, targetId);
    } finally {
      setBusy(false);
    }
  };

  /** Bulk sensitive flag flip (files only). */
  const doBulkSensitive = async (value: boolean, files: Media[]) => {
    if (!backend?.drive || !sessionId || files.length === 0) return;
    setBusy(true);
    const results = await runPool(files, f => backend.drive!.updateFile(f.id, {isSensitive: value}), {
      concurrency: 4,
    });
    const failed = results.flatMap((r, i) =>
      r.ok ? [] : [{kind: 'file' as const, id: files[i]!.id, name: files[i]!.name, error: r.error}],
    );
    invalidate.folder(sessionId, folderId);
    finishBulk('sensitive', files, [], failed, undefined, value);
    setBusy(false);
  };

  /** Confirm + run a bulk delete (files pooled, folders depth-first). */
  const confirmBulkDelete = async (
    files: Media[],
    folders: DriveFolder[],
    walks: Map<string, WalkTree>,
  ) => {
    if (!backend?.drive || !sessionId || (files.length === 0 && folders.length === 0)) return;
    setBusy(true);
    const failed: Array<{kind: 'file' | 'folder'; id: string; name: string; error: unknown}> = [];
    try {
      const fileResults = await runPool(files, f => backend.drive!.deleteFile(f.id), {concurrency: 4});
      fileResults.forEach((r, i) => {
        if (!r.ok) failed.push({kind: 'file', id: files[i]!.id, name: files[i]!.name, error: r.error});
      });
      const deletedFileIds = new Set(files.filter((_, i) => fileResults[i]?.ok).map(f => f.id));
      for (const folder of folders) {
        const walk = walks.get(folder.id);
        if (!walk) continue;
        for (const doc of walk.files) {
          if (deletedFileIds.has(doc.id)) continue;
          try {
            await backend.drive.deleteFile(doc.id);
          } catch (err) {
            failed.push({kind: 'file', id: doc.id, name: doc.name, error: err});
          }
        }
        let ok = true;
        for (const sub of [...walk.folders].reverse()) {
          try {
            await backend.drive.folders!.delete(sub.id);
          } catch (err) {
            ok = false;
            failed.push({kind: 'folder', id: sub.id, name: sub.name, error: err});
          }
        }
        try {
          if (ok) await backend.drive.folders!.delete(folder.id);
          else failed.push({kind: 'folder', id: folder.id, name: folder.name, error: new Error('child delete failed')});
        } catch (err) {
          failed.push({kind: 'folder', id: folder.id, name: folder.name, error: err});
        }
      }
      invalidate.folder(sessionId, folderId);
      finishBulk('delete', files, folders, failed);
      setDeleteBulk(null);
    } finally {
      setBusy(false);
    }
  };

  const finishBulk = (
    kind: 'move' | 'delete' | 'sensitive',
    files: Media[],
    folders: DriveFolder[],
    failed: Array<{kind: 'file' | 'folder'; id: string; name: string; error: unknown}>,
    targetId?: string | null,
    value?: boolean,
  ) => {
    const total = files.length + folders.length;
    const done = total - failed.length;
    if (failed.length === 0) {
      showToast(
        kind === 'move'
          ? i18n._(msg`Moved ${done} item(s).`)
          : kind === 'delete'
            ? i18n._(msg`Deleted ${done} item(s).`)
            : i18n._(msg`Updated ${done} item(s).`),
      );
      setFailedOps(null);
      setLastBulk(null);
      dispatchSel({type: 'clear'});
    } else {
      setLastBulk({kind, files, folders, targetId, value});
      setFailedOps(failed);
    }
  };

  const retryFailed = async () => {
    if (!lastBulk || !failedOps || failedOps.length === 0) return;
    const failedIds = new Set(failedOps.map(f => `${f.kind}:${f.id}`));
    const files = lastBulk.files.filter(f => failedIds.has(`file:${f.id}`));
    const folders = lastBulk.folders.filter(f => failedIds.has(`folder:${f.id}`));
    setFailedOps(null);
    if (lastBulk.kind === 'move') {
      await doBulkMove(lastBulk.targetId ?? null, files, folders);
    } else if (lastBulk.kind === 'delete') {
      const walks = new Map<string, WalkTree>();
      if (backend?.drive) {
        for (const folder of folders) {
          try {
            walks.set(folder.id, await walkFolderTree(backend.drive, folder.id));
          } catch {
            walks.set(folder.id, {folderId: folder.id, folders: [], files: [], truncated: false});
          }
        }
      }
      await confirmBulkDelete(files, folders, walks);
    } else {
      await doBulkSensitive(lastBulk.value ?? true, files);
    }
  };

  const emptyMessage = Platform.OS === 'web'
    ? folderId
      ? i18n._(msg`This folder is empty. Drop files here or use Upload.`)
      : i18n._(msg`You have no files yet. Drop files here or use Upload.`)
    : folderId
      ? i18n._(msg`This folder is empty.`)
      : i18n._(msg`You have no files yet.`);

  const error = folders.isError ? folders.error : files.isError ? files.error : undefined;

  return (
    <View style={atoms.flex1} testID="drive-screen">
      <CollectionScreen
        screen="drive"
        title={i18n._(msg`My Uploads`)}
        header={
          <View style={[atoms.gap_sm, atoms.px_md, {paddingTop: 8}]}>
            <Breadcrumbs trail={crumbs} onNavigate={openFolder} testID="drive-crumbs" />
            <UsageBar
              used={usage.data?.usage ?? null}
              capacity={usage.data?.capacity ?? null}
              testID="drive-usage"
            />
          </View>
        }
        toolbar={
          <View style={[atoms.px_md, atoms.py_sm]}>
            <Toolbar
              screen="drive"
              sortOptions={
                sortSupported
                  ? SORT_OPTIONS.map(o => ({key: o.key, label: o.label}))
                  : undefined
              }
              onSortChange={key => setSortKey(key as typeof sortKey)}
              filter={filter}
              onFilterChange={setFilter}
              actions={
                <>
                  <Button
                    label={i18n._(msg`New folder`)}
                    variant="secondary"
                    compact
                    onPress={() => setFolderDialog({folder: null})}
                    testID="drive-new-folder"
                  />
                  <Button
                    label={showUpload ? i18n._(msg`Hide upload`) : i18n._(msg`Upload`)}
                    variant="primary"
                    compact
                    onPress={() => setShowUpload(v => !v)}
                    testID="drive-upload-toggle"
                  />
                </>
              }
              testID="drive-toolbar"
            />
            {showUpload ? (
              <UploadPanel
                targetLabel={i18n._(msg`Uploads go to this folder.`)}
                staged={staged}
                comment={uploadComment}
                uploading={uploading}
                error={uploadError}
                success={uploadSuccess}
                onChoose={() => void chooseFile()}
                onCommentChange={setUploadComment}
                onUpload={() => void uploadStaged()}
                onCancel={() => {
                  setStaged(null);
                  setUploadComment('');
                  setUploadError(null);
                }}
              />
            ) : null}
          </View>
        }
        selectionBar={
          sel.selected.length > 0 ? (
            <View style={[atoms.px_md]}>
              <SelectionBar
                count={sel.selected.length}
                onClear={() => dispatchSel({type: 'clear'})}
                testID="drive-selection"
                actions={
                  <>
                    <Button
                      label={i18n._(msg`Move to…`)}
                      variant="secondary"
                      compact
                      disabled={busy}
                      onPress={() => void openMoveTarget({bulk: {files: selectedFiles, folders: selectedFolders}})}
                      testID="drive-bulk-move"
                    />
                    <Button
                      label={i18n._(msg`Mark sensitive`)}
                      variant="secondary"
                      compact
                      disabled={busy || selectedFiles.length === 0}
                      onPress={() => void doBulkSensitive(true, selectedFiles)}
                      testID="drive-bulk-sensitive"
                    />
                    <Button
                      label={i18n._(msg`Unmark`)}
                      variant="secondary"
                      compact
                      disabled={busy || selectedFiles.length === 0}
                      onPress={() => void doBulkSensitive(false, selectedFiles)}
                      testID="drive-bulk-unsensitive"
                    />
                    <Button
                      label={i18n._(msg`Delete`)}
                      variant="secondary"
                      compact
                      disabled={busy}
                      onPress={() => void openBulkDelete()}
                      testID="drive-bulk-delete"
                    />
                  </>
                }
              />
            </View>
          ) : undefined
        }
        items={items}
        render={{
          selected: key => isSelected(sel, key),
          selectionMode: selectMode,
          onOpen: handlePress,
          onToggle: key => dispatchSel({type: 'toggle', key}),
          onLongPress: key => dispatchSel({type: 'enterMode', key}),
          menu: item => {
            const folder = visibleFolders.find(f => f.id === item.key);
            if (folder) {
              return (
                <Menu
                  label={i18n._(msg`Folder options`)}
                  trigger={<MoreIcon size={16} />}
                  items={[
                    {key: 'rename', label: i18n._(msg`Rename`), onSelect: () => setFolderDialog({folder})},
                    {key: 'move', label: i18n._(msg`Move to…`), onSelect: () => void openMoveTarget({folder})},
                    {key: 'delete', label: i18n._(msg`Delete`), onSelect: () => void askDeleteFolder(folder)},
                  ]}
                  testID={`drive-folder-menu-${folder.id}`}
                />
              );
            }
            const file = visibleFiles.find(f => f.id === item.key);
            if (!file) return undefined;
            return (
              <Menu
                label={i18n._(msg`File options`)}
                trigger={<MoreIcon size={16} />}
                items={[
                  {key: 'details', label: i18n._(msg`Details`), onSelect: () => setDetailFile(file)},
                  {key: 'move', label: i18n._(msg`Move to…`), onSelect: () => void openMoveTarget({file})},
                  {
                    key: 'delete',
                    label: i18n._(msg`Delete`),
                    onSelect: () => setDeleteFile(file),
                  },
                ]}
                testID={`drive-file-menu-${file.id}`}
              />
            );
          },
          dataSaver,
          testID: 'drive-item',
        }}
        session={session}
        loading={folders.isPending || files.isPending}
        error={error}
        errorMessage={i18n._(msg`Could not load drive.`)}
        onRetry={() => {
          void folders.refetch();
          void files.refetch();
        }}
        emptyMessage={emptyMessage}
        onEndReached={() => {
          if (files.hasNextPage && !files.isFetchingNextPage) void files.fetchNextPage();
        }}
        refreshing={folders.isRefetching || files.isRefetching}
        onRefresh={() => {
          void folders.refetch();
          void files.refetch();
        }}
        footer={files.isFetchingNextPage ? <Loader testID="drive-collection-more" /> : undefined}
        testID="drive-collection"
      />
      {actionError ? (
        <Caption color="faint" testID="drive-action-error">
          {actionError}
        </Caption>
      ) : null}
      {detailFile && backend.drive ? (
        gtTablet ? (
          <View
            style={[styles.dock, {backgroundColor: theme.palette.bg, borderColor: theme.palette.border}]}
            testID="drive-detail-dock">
            <ScrollView style={atoms.flex1}>
              <FileDetailPanel
                file={detailFile}
                backend={backend}
                sessionId={sessionId}
                onMove={file => void openMoveTarget({file})}
                onChanged={() => {
                  invalidate.folder(sessionId, folderId);
                  setDetailFile(null);
                }}
                onDeleted={() => {
                  invalidate.folder(sessionId, folderId);
                  setDetailFile(null);
                }}
                testID="drive-detail"
              />
            </ScrollView>
            <View style={[atoms.px_md, atoms.py_sm]}>
              <Button
                label={i18n._(msg`Close`)}
                variant="secondary"
                onPress={() => setDetailFile(null)}
                testID="drive-detail-close"
              />
            </View>
          </View>
        ) : (
          <Dialog open onClose={() => setDetailFile(null)} title={detailFile.name} testID="drive-detail-dialog">
            <FileDetailPanel
              file={detailFile}
              backend={backend}
              sessionId={sessionId}
              onMove={file => void openMoveTarget({file})}
              onChanged={() => {
                invalidate.folder(sessionId, folderId);
              }}
              onDeleted={() => {
                invalidate.folder(sessionId, folderId);
                setDetailFile(null);
              }}
              testID="drive-detail"
            />
          </Dialog>
        )
      ) : null}
      {folderDialog ? (
        <FolderDialog
          initialName={folderDialog.folder?.name ?? ''}
          title={folderDialog.folder ? i18n._(msg`Rename folder`) : i18n._(msg`New folder`)}
          onSave={async name => {
            if (!sessionId) return;
            if (folderDialog.folder) {
              await folderMutations.rename.mutateAsync({id: folderDialog.folder.id, name});
            } else {
              await folderMutations.create.mutateAsync({name, parentId: folderId});
            }
            invalidate.folder(sessionId, folderId);
            setFolderDialog(null);
          }}
          onClose={() => setFolderDialog(null)}
          testID="drive-folder-dialog"
        />
      ) : null}
      {moveTarget ? (
        <MoveToDialog
          sessionId={sessionId}
          currentParentId={'folder' in moveTarget ? moveTarget.folder.parentId : folderId}
          descendantIds={moveDescendants}
          onMove={targetId => doMove(targetId)}
          onClose={() => setMoveTarget(null)}
          testID="drive-move"
        />
      ) : null}
      {deleteFolder ? (
        <Dialog
          open
          onClose={() => setDeleteFolder(null)}
          title={i18n._(msg`Delete “${deleteFolder.folder.name}” with ${deleteFolder.walk.files.length} files and ${deleteFolder.walk.folders.length} subfolders? This is permanent.`)}
          testID="drive-folder-delete">
          {deleteFolder.walk.files.length > 0 ? (
            <Caption color="faint" testID="drive-folder-delete-names">
              {deleteFolder.walk.files.slice(0, 5).map(f => f.name).join(', ')}
            </Caption>
          ) : null}
          <Button
            label={busy ? i18n._(msg`Deleting…`) : i18n._(msg`Confirm delete`)}
            variant="secondary"
            disabled={busy}
            onPress={() => void confirmDeleteFolder()}
            testID="drive-folder-delete-confirm"
          />
          <Button
            label={i18n._(msg`Keep`)}
            variant="secondary"
            disabled={busy}
            onPress={() => setDeleteFolder(null)}
            testID="drive-folder-delete-cancel"
          />
        </Dialog>
      ) : null}
      {deleteBulk ? (
        <Dialog
          open
          onClose={() => setDeleteBulk(null)}
          title={i18n._(msg`Delete ${deleteBulk.files.length + deleteBulk.folders.length} selected item(s)? This is permanent.`)}
          testID="drive-bulk-delete-dialog">
          <Caption color="faint" testID="drive-bulk-delete-names">
            {[...deleteBulk.files.slice(0, 5).map(f => f.name), ...deleteBulk.folders.slice(0, 5).map(f => f.name)].join(', ')}
          </Caption>
          <Button
            label={busy ? i18n._(msg`Deleting…`) : i18n._(msg`Confirm delete`)}
            variant="secondary"
            disabled={busy}
            onPress={() => void confirmBulkDelete(deleteBulk.files, deleteBulk.folders, deleteBulk.walks)}
            testID="drive-bulk-delete-confirm"
          />
          <Button
            label={i18n._(msg`Keep`)}
            variant="secondary"
            disabled={busy}
            onPress={() => setDeleteBulk(null)}
            testID="drive-bulk-delete-cancel"
          />
        </Dialog>
      ) : null}
      {failedOps && failedOps.length > 0 ? (
        <Dialog
          open
          onClose={() => {
            setFailedOps(null);
            setLastBulk(null);
          }}
          title={i18n._(msg`Some items could not be processed.`)}
          testID="drive-bulk-failed">
          <Caption color="faint" testID="drive-bulk-failed-names">
            {failedOps.slice(0, 5).map(f => `${f.name} (${errorText(i18n, f.error, i18n._(msg`failed`))})`).join(', ')}
          </Caption>
          <Button
            label={i18n._(msg`Retry failed`)}
            variant="primary"
            disabled={busy}
            onPress={() => void retryFailed()}
            testID="drive-bulk-retry"
          />
          <Button
            label={i18n._(msg`Dismiss`)}
            variant="secondary"
            disabled={busy}
            onPress={() => {
              setFailedOps(null);
              setLastBulk(null);
            }}
            testID="drive-bulk-dismiss"
          />
        </Dialog>
      ) : null}
      {deleteFile ? (
        <Dialog
          open
          onClose={() => setDeleteFile(null)}
          title={i18n._(msg`Delete “${deleteFile.name}”? This is permanent.`)}
          testID="drive-file-delete">
          <Button
            label={busy ? i18n._(msg`Deleting…`) : i18n._(msg`Confirm delete`)}
            variant="secondary"
            disabled={busy}
            onPress={() => {
              if (!sessionId) return;
              setBusy(true);
              fileMutations.remove.mutate(
                {id: deleteFile.id, folderId},
                {
                  onSuccess: () => setDeleteFile(null),
                  onError: err => setActionError(errorText(i18n, err, i18n._(msg`Could not delete the file.`))),
                  onSettled: () => setBusy(false),
                },
              );
            }}
            testID="drive-file-delete-confirm"
          />
          <Button
            label={i18n._(msg`Keep`)}
            variant="secondary"
            disabled={busy}
            onPress={() => setDeleteFile(null)}
            testID="drive-file-delete-cancel"
          />
        </Dialog>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  /** Tablet detail dock: absolute right panel over the list. */
  dock: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 380,
    borderStartWidth: 1,
  },
});
