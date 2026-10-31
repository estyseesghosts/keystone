// File detail panel (P6.6 slice 5): metadata (`showFile`) + attached
// notes, with the panel actions — Rename, Caption, Sensitive toggle,
// Move to…, Copy link, Download/Open, Delete (confirm). Ported from
// `screens/Drive/detail.tsx` (same honest states) with the actions the
// old row menus carried.

import {useCallback, useEffect, useState} from 'react';
import {Linking, ScrollView, View} from 'react-native';
import {msg} from '@lingui/macro';

import {
  displayNameOf,
  handleOf,
  isPermissionError,
  isUnsupportedError,
  type Backend,
  type Cursor,
  type Media,
  type Post,
} from '@keystone/fedi';

import {atoms} from '#/alf/atoms';
import {Body, Caption} from '#/alf/typography';
import {AppImage} from '#/components/Image';
import {Button} from '#/components/Button';
import {Dialog} from '#/components/Dialog';
import {Loader} from '#/components/Loader';
import {TextField} from '#/components/forms/TextField';
import {Pressable} from '#/components/Pressable';
import {postBodyNodes} from '#/components/Post/body';
import {RichText} from '#/components/RichText';
import {canCopy, copyText} from '#/lib/clipboard';
import {errorText} from '#/lib/localeErrors';
import {i18n} from '#/locale/i18n';
import {showToast} from '#/lib/toast';

import {formatBytes} from './UsageBar';

const NOTES_PAGE = 10;

export function MetaRow({label, value, testID}: {label: string; value: string; testID?: string}) {
  return (
    <View style={[atoms.row, atoms.gap_sm]} testID={testID}>
      <Caption color="faint">{label}</Caption>
      <Body style={{flexShrink: 1}}>{value}</Body>
    </View>
  );
}

export function AttachedNoteRow({post, sessionId}: {post: Post; sessionId: string}) {
  const nodes = postBodyNodes(post);
  return (
    <View style={[atoms.gap_sm]} testID={`drive-detail-note-${post.id}`}>
      <Caption color="faint">
        {`${displayNameOf(post.author)} ${handleOf(post.author)} · ${post.createdAt}`}
      </Caption>
      <RichText nodes={nodes} sessionId={sessionId} authorHost={post.author.host} />
    </View>
  );
}

type NotesState = 'loading' | 'ready' | 'unsupported' | 'denied' | 'error';

export function FileDetailPanel({
  file,
  backend,
  sessionId,
  onMove,
  onChanged,
  onDeleted,
  testID,
}: {
  file: Media;
  backend: Backend;
  sessionId: string;
  onMove: (file: Media) => void;
  onChanged: () => void;
  onDeleted: () => void;
  testID?: string;
}) {
  const drive = backend.drive;
  const [media, setMedia] = useState<Media>(file);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailUnsupported, setDetailUnsupported] = useState(false);
  const [notes, setNotes] = useState<Post[]>([]);
  const [notesState, setNotesState] = useState<NotesState>('loading');
  const [notesError, setNotesError] = useState<string | null>(null);
  const [notesCursor, setNotesCursor] = useState<Cursor | null>(null);
  const [notesHasMore, setNotesHasMore] = useState(false);
  const [notesLoadingMore, setNotesLoadingMore] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [captioning, setCaptioning] = useState(false);
  const [draft, setDraft] = useState(file.name);
  const [comment, setComment] = useState(file.description ?? '');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!drive) return;
    setDetailError(null);
    setDetailUnsupported(false);
    try {
      setMedia(await drive.showFile(file.id));
    } catch (err) {
      if (isUnsupportedError(err)) setDetailUnsupported(true);
      else if (isPermissionError(err)) setDetailError(i18n._(msg`Your account cannot view this file.`));
      else setDetailError(errorText(i18n, err, i18n._(msg`Could not load file details.`)));
    }
  }, [drive, file.id]);

  const loadNotes = useCallback(async () => {
    if (!drive) return;
    setNotesState('loading');
    setNotesError(null);
    setNotes([]);
    setNotesCursor(null);
    setNotesHasMore(false);
    try {
      const page = await drive.attachedNotes(file.id, {limit: NOTES_PAGE});
      setNotes(page.items);
      setNotesCursor(page.cursor);
      setNotesHasMore(!page.end);
      setNotesState('ready');
    } catch (err) {
      if (isUnsupportedError(err)) setNotesState('unsupported');
      else if (isPermissionError(err)) setNotesState('denied');
      else {
        setNotesState('error');
        setNotesError(errorText(i18n, err, i18n._(msg`Could not load notes for this file.`)));
      }
    }
  }, [drive, file.id]);

  useEffect(() => {
    setMedia(file);
    setDraft(file.name);
    setComment(file.description ?? '');
    setRenaming(false);
    setCaptioning(false);
    setConfirmDelete(false);
    void loadDetail();
    void loadNotes();
  }, [file, loadDetail, loadNotes]);

  const loadMoreNotes = async () => {
    if (!drive || !notesCursor || notesLoadingMore) return;
    setNotesLoadingMore(true);
    setNotesError(null);
    try {
      const page = await drive.attachedNotes(file.id, {limit: NOTES_PAGE, cursor: notesCursor});
      setNotes(prev => [...prev, ...page.items.filter(p => !prev.some(n => n.id === p.id))]);
      setNotesCursor(page.cursor);
      setNotesHasMore(!page.end);
    } catch (err) {
      setNotesError(errorText(i18n, err, i18n._(msg`Could not load more notes.`)));
    } finally {
      setNotesLoadingMore(false);
    }
  };

  const savePatch = async (patch: {name?: string; isSensitive?: boolean; comment?: string | null}) => {
    if (!drive || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const updated = await drive.updateFile(file.id, patch);
      setMedia(updated);
      onChanged();
    } catch (err) {
      setActionError(errorText(i18n, err, i18n._(msg`Could not update the file.`)));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!drive || busy) return;
    setBusy(true);
    try {
      await drive.deleteFile(file.id);
      setConfirmDelete(false);
      onDeleted();
    } catch (err) {
      setActionError(errorText(i18n, err, i18n._(msg`Could not delete the file.`)));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!media.url) return;
    try {
      await copyText(media.url);
      showToast(i18n._(msg`Copied`));
    } catch (err) {
      showToast(errorText(i18n, err, i18n._(msg`Could not copy the link.`)));
    }
  };

  return (
    <ScrollView style={atoms.flex1} contentContainerStyle={[atoms.gap_sm, atoms.p_md]} testID={testID}>
      {media.url ? (
        <AppImage
          uri={media.url}
          blurhash={media.blurhash}
          contentFit="contain"
          testID={testID ? `${testID}-preview` : undefined}
          style={{width: '100%', minHeight: 200}}
        />
      ) : null}
      <MetaRow label={i18n._(msg`Name`)} value={media.name} testID={testID ? `${testID}-name` : undefined} />
      <MetaRow label={i18n._(msg`Type`)} value={media.mimeType} testID={testID ? `${testID}-type` : undefined} />
      <MetaRow
        label={i18n._(msg`Size`)}
        value={formatBytes(media.size)}
        testID={testID ? `${testID}-size` : undefined}
      />
      <MetaRow
        label={i18n._(msg`Sensitive`)}
        value={media.isSensitive ? i18n._(msg`Yes`) : i18n._(msg`No`)}
        testID={testID ? `${testID}-sensitive` : undefined}
      />
      <MetaRow
        label={i18n._(msg`Comment`)}
        value={media.description ?? i18n._(msg`No description`)}
        testID={testID ? `${testID}-comment` : undefined}
      />
      {detailUnsupported ? (
        <Caption color="faint">{i18n._(msg`This server does not support file details.`)}</Caption>
      ) : null}
      {detailError ? (
        <View style={[atoms.gap_sm]}>
          <Caption color="faint">{detailError}</Caption>
          <Button
            label={i18n._(msg`Retry`)}
            variant="secondary"
            onPress={() => void loadDetail()}
            testID={testID ? `${testID}-retry` : undefined}
          />
        </View>
      ) : null}
      {actionError ? <Caption color="faint">{actionError}</Caption> : null}
      <View style={[atoms.row, atoms.gap_sm]}>
        <Button
          label={i18n._(msg`Rename`)}
          variant="secondary"
          compact
          onPress={() => {
            setDraft(media.name);
            setRenaming(v => !v);
          }}
          testID={testID ? `${testID}-rename` : undefined}
        />
        <Button
          label={i18n._(msg`Caption`)}
          variant="secondary"
          compact
          onPress={() => {
            setComment(media.description ?? '');
            setCaptioning(v => !v);
          }}
          testID={testID ? `${testID}-caption` : undefined}
        />
        <Pressable
          onPress={() => void savePatch({isSensitive: !media.isSensitive})}
          accessibilityRole="switch"
          accessibilityState={{checked: media.isSensitive}}
          accessibilityLabel={i18n._(msg`Sensitive`)}
          disabled={busy}
          testID={testID ? `${testID}-sensitive-toggle` : undefined}>
          <Body>{media.isSensitive ? i18n._(msg`Sensitive: on`) : i18n._(msg`Sensitive: off`)}</Body>
        </Pressable>
      </View>
      {renaming ? (
        <View style={[atoms.gap_sm]}>
          <TextField
            label={i18n._(msg`File name`)}
            value={draft}
            onChangeText={setDraft}
            testID={testID ? `${testID}-rename-input` : undefined}
          />
          <Button
            label={busy ? i18n._(msg`Saving…`) : i18n._(msg`Save`)}
            variant="primary"
            disabled={busy || draft.trim() === ''}
            onPress={() => {
              setRenaming(false);
              void savePatch({name: draft.trim()});
            }}
            testID={testID ? `${testID}-rename-save` : undefined}
          />
        </View>
      ) : null}
      {captioning ? (
        <View style={[atoms.gap_sm]}>
          <TextField
            label={i18n._(msg`Caption`)}
            value={comment}
            onChangeText={setComment}
            testID={testID ? `${testID}-caption-input` : undefined}
          />
          <Button
            label={busy ? i18n._(msg`Saving…`) : i18n._(msg`Save`)}
            variant="primary"
            disabled={busy}
            onPress={() => {
              setCaptioning(false);
              void savePatch({comment: comment === '' ? null : comment});
            }}
            testID={testID ? `${testID}-caption-save` : undefined}
          />
        </View>
      ) : null}
      <View style={[atoms.row, atoms.gap_sm]}>
        <Button
          label={i18n._(msg`Move to…`)}
          variant="secondary"
          compact
          onPress={() => onMove(media)}
          testID={testID ? `${testID}-move` : undefined}
        />
        <Button
          label={i18n._(msg`Copy link`)}
          variant="secondary"
          compact
          disabled={!canCopy() || !media.url}
          onPress={() => void copyLink()}
          testID={testID ? `${testID}-copy` : undefined}
        />
        <Button
          label={i18n._(msg`Open`)}
          variant="secondary"
          compact
          disabled={!media.url}
          onPress={() => {
            if (media.url) void Linking.openURL(media.url);
          }}
          testID={testID ? `${testID}-open` : undefined}
        />
        <Button
          label={i18n._(msg`Delete`)}
          variant="secondary"
          compact
          onPress={() => setConfirmDelete(true)}
          testID={testID ? `${testID}-delete` : undefined}
        />
      </View>
      <View style={[atoms.gap_sm]} testID={testID ? `${testID}-notes` : undefined}>
        <Body>{i18n._(msg`Notes using this file`)}</Body>
        {notesState === 'loading' ? (
          <Loader testID={testID ? `${testID}-notes-loading` : undefined} />
        ) : notesState === 'unsupported' ? (
          <Caption color="faint">{i18n._(msg`This server does not support showing notes that use a file.`)}</Caption>
        ) : notesState === 'denied' ? (
          <Caption color="faint">{i18n._(msg`Your account cannot view the notes for this file.`)}</Caption>
        ) : notesState === 'error' ? (
          <View style={[atoms.gap_sm]}>
            <Caption color="faint">{notesError ?? i18n._(msg`Could not load notes for this file.`)}</Caption>
            <Button
              label={i18n._(msg`Retry`)}
              variant="secondary"
              onPress={() => void loadNotes()}
              testID={testID ? `${testID}-notes-retry` : undefined}
            />
          </View>
        ) : notes.length === 0 ? (
          <Caption color="faint">{i18n._(msg`No notes use this file.`)}</Caption>
        ) : (
          <>
            {notes.map(post => (
              <AttachedNoteRow key={post.id} post={post} sessionId={sessionId} />
            ))}
            {notesHasMore ? (
              <Button
                label={notesLoadingMore ? i18n._(msg`Loading…`) : i18n._(msg`Load more notes`)}
                variant="secondary"
                disabled={notesLoadingMore}
                onPress={() => void loadMoreNotes()}
                testID={testID ? `${testID}-notes-more` : undefined}
              />
            ) : null}
          </>
        )}
      </View>
      {confirmDelete ? (
        <Dialog
          open
          onClose={() => setConfirmDelete(false)}
          title={i18n._(msg`Delete “${media.name}”? This is permanent.`)}
          testID={testID ? `${testID}-delete-confirm` : undefined}>
          <Button
            label={busy ? i18n._(msg`Deleting…`) : i18n._(msg`Delete`)}
            variant="secondary"
            disabled={busy}
            onPress={() => void doDelete()}
            testID={testID ? `${testID}-delete-yes` : undefined}
          />
          <Button
            label={i18n._(msg`Keep`)}
            variant="secondary"
            disabled={busy}
            onPress={() => setConfirmDelete(false)}
            testID={testID ? `${testID}-delete-no` : undefined}
          />
        </Dialog>
      ) : null}
    </ScrollView>
  );
}
