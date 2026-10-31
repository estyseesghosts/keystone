// My Uploads on the collection kit (P6.6 slice 5): folders, files,
// breadcrumbs (`/drive/:folderId?`, DC-13), usage, sort, filter,
// detail panel, single-item actions. Multi-select, upload queue and DnD
// land in slices 6–8.

import {useEffect, useMemo, useState} from 'react';
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
  const [moveTarget, setMoveTarget] = useState<{file: Media} | {folder: DriveFolder} | null>(null);
  const [moveDescendants, setMoveDescendants] = useState<string[]>([]);
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
  const q = filter.trim().toLowerCase();
  const visibleFolders = q ? folderItems.filter(f => f.name.toLowerCase().includes(q)) : folderItems;
  const visibleFiles = q ? fileItems.filter(f => f.name.toLowerCase().includes(q)) : fileItems;

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

  useEffect(() => {
    setDetailFile(null);
    setFilter('');
  }, [folderId]);

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

  const openMoveTarget = async (target: {file: Media} | {folder: DriveFolder}) => {
    setMoveTarget(target);
    if ('folder' in target && backend?.drive) {
      try {
        const walk = await walkFolderTree(backend.drive, target.folder.id);
        setMoveDescendants([target.folder.id, ...walk.folders.map(f => f.id)]);
      } catch {
        setMoveDescendants([target.folder.id]);
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
    }
    setMoveTarget(null);
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
        items={items}
        render={{
          selected: () => false,
          selectionMode: false,
          onOpen: key => {
            const folder = visibleFolders.find(f => f.id === key);
            if (folder) {
              openFolder(folder.id);
              return;
            }
            const file = visibleFiles.find(f => f.id === key);
            if (file) setDetailFile(file);
          },
          onToggle: () => {},
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
