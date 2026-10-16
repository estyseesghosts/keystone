// Post composer: text + visibility + attachments + CW + polls + scheduling,
// wired to `notes/create` (reply via `replyId`, quote via `renoteId`).
// Layout follows the reference client: an avatar-led inline box with an
// audience pill and an icon toolbar (media, poll, emoji, CW, schedule — no
// GIF or location buttons, which have no backend here). The detail route
// uses compact mode: a single "Post your reply" row that expands into the
// full editor ("Replying to @user", autofocus) on click and collapses
// again after posting.
//
// Parity notes:
// - Polls are always offered (§5 un-gated): backends without polls reject
//   with a verbatim error (CANNOT_CREATE_ALREADY_EXPIRED_POLL and friends).
// - Reaction visibility (§3) sends `reactionAcceptance`; the badge lives in
//   `NoteCard`. 404 means the backend does not store it.
// - Quote refusal (§4): per-note `noQuote` plus the account switch in
//   Settings. A QUOTE_DISABLED_FOR_USER rejection keeps the text, drops
//   the `renoteId`, and shows the server reason.
// - Scheduling (§6): `notes/schedule/create` with an ISO `scheduledAt`.
//   404 keeps the control disabled with reason; the backend's
//   TOO_MANY_SCHEDULED_NOTES / SCHEDULED_AT_REQUIRED / MUST_BE_IN_FUTURE
//   errors surface verbatim.
// - Drafts (§7) capture the full composer state; the inline composer has
//   the same `Drafts (n)` entry as the floating one.
// - Edit mode (§10): with `editingId`, the same surface PATCHes the note
//   via `notes/edit` instead of creating one.

import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiCall, apiCallPublic, ApiError, isUnsupportedError } from "../api/client";
import type {
  CreatedNoteResponse,
  DriveFile,
  Note,
  NoteVisibility,
  ReactionAcceptance,
  ScheduledNote,
  UserLite,
} from "../api/types";
import { REACTION_ACCEPTANCE_LABELS } from "../api/types";
import { useAuth } from "../state/auth";
import { Avatar } from "./NoteBody";
import { displayNameOf } from "../api/types";
import { MediaIcon, MoreIcon, PollIcon, ScheduleIcon } from "./icons";
import { EmojiPickerButton } from "./EmojiPicker";
import VisibilityPicker from "./VisibilityPicker";
import type { Draft, DraftPayload } from "../api/drafts";
import { deleteDraft, isKeepable, listDrafts, saveDraft } from "../api/drafts";
import { editNote } from "../api/noteEdit";
import { createScheduledNote, isFutureInstant, parseScheduledAt } from "../api/schedule";
import { createServerDraft } from "../api/serverDrafts";
import DriveBrowser from "./DriveBrowser";

const FALLBACK_LIMIT = 3000;

// Server-advertised text limit (meta.maxNoteTextLength, 3000 on all three
// local backends), fetched once and cached. Falls back safely when meta is
// unreachable so the composer never blocks on it.
let cachedLimit: number | null = null;
async function textLimit(): Promise<number> {
  if (cachedLimit !== null) return cachedLimit;
  try {
    const meta = await apiCallPublic<{ maxNoteTextLength?: number }>("meta", {});
    cachedLimit =
      typeof meta.maxNoteTextLength === "number" && meta.maxNoteTextLength > 0
        ? meta.maxNoteTextLength
        : FALLBACK_LIMIT;
  } catch {
    cachedLimit = FALLBACK_LIMIT;
  }
  return cachedLimit;
}

const POLL_EXPIRIES: { label: string; seconds: number | null }[] = [
  { label: "1 hour", seconds: 3600 },
  { label: "24 hours", seconds: 86400 },
  { label: "7 days", seconds: 604800 },
  { label: "No expiry", seconds: null },
];

const REACTION_OPTIONS: Array<{ value: ReactionAcceptance | ""; label: string }> = [
  { value: "", label: "All reactions" },
  ...(Object.entries(REACTION_ACCEPTANCE_LABELS) as Array<[ReactionAcceptance, string]>).map(
    ([value, label]) => ({ value, label }),
  ),
];

function stubUser(r: { id: string; username: string; host: string | null }): UserLite {
  return {
    id: r.id,
    name: r.username,
    username: r.username,
    host: r.host,
    avatarUrl: null,
    avatarBlurhash: null,
    isBot: false,
    isCat: false,
    emojis: {},
    onlineStatus: "unknown",
  };
}

function stubFile(f: { id: string; name: string }): DriveFile {
  return {
    id: f.id,
    createdAt: new Date(0).toISOString(),
    name: f.name,
    type: "",
    md5: "",
    size: 0,
    isSensitive: false,
    blurhash: null,
    properties: {},
    url: "",
    thumbnailUrl: null,
    comment: null,
    folderId: null,
    userId: null,
  };
}

function RecipientPicker(props: {
  recipients: UserLite[];
  onAdd: (user: UserLite) => void;
  onRemove: (id: string) => void;
}) {
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<UserLite[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [searchError, setSearchError] = createSignal<string | null>(null);

  const search = async () => {
    const q = query().trim();
    if (q.length === 0 || searching()) return;
    setSearching(true);
    setSearchError(null);
    try {
      // Authenticated search: Misskey requires a credential here.
      const users = await apiCall<UserLite[]>("users/search", { query: q, limit: 5 });
      setResults(users);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div class="field">
      <label>Recipients (specified visibility)</label>
      <Show when={props.recipients.length > 0}>
        <div class="chips">
          <For each={props.recipients}>
            {(u) => (
              <span class="chip">
                @{u.username}{u.host ? `@${u.host}` : ""}
                <button type="button" onClick={() => props.onRemove(u.id)} aria-label={`Remove ${u.username}`}>×</button>
              </span>
            )}
          </For>
        </div>
      </Show>
      <div class="row">
        <input
          type="text"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search users…"
          aria-label="Search users to add"
        />
        <button type="button" disabled={searching() || query().trim().length === 0} onClick={() => void search()}>
          {searching() ? "Searching…" : "Search"}
        </button>
      </div>
      <Show when={searchError()}>
        <div class="err" role="alert">{searchError()}</div>
      </Show>
      <Show when={results().length > 0}>
        <div class="feed">
          <For each={results()}>
            {(u) => (
              <div class="drivefile">
                <span>@{u.username}{u.host ? `@${u.host}` : ""}</span>
                <button
                  type="button"
                  disabled={props.recipients.some((r) => r.id === u.id)}
                  onClick={() => props.onAdd(u)}
                >
                  Add
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export default function Composer(props: {
  replyId?: string;
  renoteId?: string;
  onPosted: (note: Note) => void;
  /** Fired when a scheduled post is accepted (no Note exists yet). */
  onScheduled?: (scheduled: ScheduledNote) => void;
  /** Collapsed "Post your reply" row until clicked (detail route). */
  compact?: boolean;
  /** Shown as "Replying to …" once expanded (already includes `@`). */
  replyingTo?: string;
  /** Starting values when restoring a draft (read once, at setup). */
  initial?: DraftPayload;
  /** Edit mode (§10): PATCH this note via `notes/edit` instead of posting. */
  editingId?: string;
  /** Fired when the backend 404s `notes/edit` (caller shows redraft). */
  onEditUnsupported?: () => void;
  /** Receives a reader for the current draft payload (floating composer
   * auto-save and draft-restore guards). A plain handle, not state. */
  captureRef?: { current: (() => DraftPayload) | null };
}) {
  const auth = useAuth();
  const editMode = () => props.editingId !== undefined;
  const isCompact = () => props.compact === true;
  const [expanded, setExpanded] = createSignal(!isCompact());
  const [text, setText] = createSignal(props.initial?.text ?? "");
  const [cw, setCw] = createSignal(props.initial?.cw ?? "");
  const [showCw, setShowCw] = createSignal((props.initial?.cw ?? "").length > 0);
  const [visibility, setVisibility] = createSignal<NoteVisibility>(
    props.initial?.visibility ?? "public",
  );
  const [recipients, setRecipients] = createSignal<UserLite[]>(
    (props.initial?.recipients ?? []).map(stubUser),
  );
  const [localOnly, setLocalOnly] = createSignal(props.initial?.localOnly ?? false);
  const [limit, setLimit] = createSignal(FALLBACK_LIMIT);
  const [attached, setAttached] = createSignal<DriveFile[]>(
    (props.initial?.attachedFiles ?? []).map(stubFile),
  );
  const [showAttach, setShowAttach] = createSignal(false);
  const [usePoll, setUsePoll] = createSignal(!!props.initial?.poll);
  const [choices, setChoices] = createSignal<string[]>(
    props.initial?.poll && props.initial.poll.choices.length >= 2
      ? props.initial.poll.choices
      : ["", ""],
  );
  const [multiple, setMultiple] = createSignal(props.initial?.poll?.multiple ?? false);
  const [expiry, setExpiry] = createSignal<number | null>(props.initial?.poll?.expiry ?? 86400);
  const [reactionAcceptance, setReactionAcceptance] = createSignal<ReactionAcceptance | "">(
    props.initial?.reactionAcceptance ?? "",
  );
  const [noQuote, setNoQuote] = createSignal(props.initial?.noQuote ?? false);
  const [scheduleOpen, setScheduleOpen] = createSignal(!!props.initial?.scheduledAt);
  const [scheduleInput, setScheduleInput] = createSignal(
    props.initial?.scheduledAt ? toLocalInput(props.initial.scheduledAt) : "",
  );
  const [scheduleUnsupported, setScheduleUnsupported] = createSignal(false);
  const [posting, setPosting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [showDrafts, setShowDrafts] = createSignal(false);
  const [drafts, setDrafts] = createSignal<Draft[]>([]);
  const [draftsScheduledOnly, setDraftsScheduledOnly] = createSignal(false);
  const [serverDraftNotice, setServerDraftNotice] = createSignal<string | null>(null);
  // Advanced options (§§3, 4, 6, 7) live in the More popup menu
  // (vispick style, like the audience picker) — never inline blocks, so
  // the composer keeps its cohesive surface.
  const [menuOpen, setMenuOpen] = createSignal(false);

  // The menu closes on outside click or Escape (visibility-menu pattern).
  createEffect(() => {
    if (!menuOpen()) return;
    const onDocClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.(".optmenu-wrap")) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    });
  });

  /** Any non-default menu option: dots the More trigger. */
  const advancedActive = () =>
    reactionAcceptance() !== "" || noQuote() || localOnly() || scheduledAt() !== null;
  let area: HTMLTextAreaElement | undefined;

  /** Fit the field to its content: the composer only ever grows and
   * shrinks with the text (manual resize is disabled in CSS). Capped at
   * 40% of the viewport — past that the field itself scrolls. */
  const fitArea = () => {
    const el = area;
    if (!el) return;
    el.style.height = "auto";
    const max = Math.max(120, Math.floor(window.innerHeight * 0.4));
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  };

  onMount(() => fitArea());

  void textLimit().then(setLimit);

  // Seed recipient ids that arrived without display stubs (server drafts).
  if ((props.initial?.recipientIds ?? []).length > 0 && recipients().length === 0) {
    setRecipients(props.initial!.recipientIds!.map((id) => stubUser({ id, username: id.slice(0, 8), host: null })));
  }
  // Seed attachments that arrived as bare ids (server drafts).
  if ((props.initial?.fileIds ?? []).length > 0 && attached().length === 0) {
    setAttached(props.initial!.fileIds!.map((id) => stubFile({ id, name: id.slice(0, 8) })));
  }

  function toLocalInput(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const payload = (): DraftPayload => ({
    text: text(),
    cw: cw(),
    visibility: visibility(),
    localOnly: localOnly(),
    recipientIds: recipients().map((r) => r.id),
    recipients: recipients().map((r) => ({ id: r.id, username: r.username, host: r.host })),
    fileIds: attached().map((f) => f.id),
    attachedFiles: attached().map((f) => ({ id: f.id, name: f.name })),
    poll: usePoll()
      ? { choices: choices(), multiple: multiple(), expiry: expiry() }
      : null,
    ...(props.replyId ? { replyId: props.replyId } : {}),
    ...(props.renoteId ? { renoteId: props.renoteId } : {}),
    scheduledAt: scheduleOpen() ? parseScheduledAt(scheduleInput()) : null,
    reactionAcceptance: (reactionAcceptance() === "" ? null : reactionAcceptance()) as ReactionAcceptance | null,
    noQuote: noQuote(),
  });

  // Draft support reads the live payload through this handle (called
  // from event handlers, never tracked).
  if (props.captureRef) {
    props.captureRef.current = () => payload();
  }

  const pollChoices = () => choices().map((c) => c.trim()).filter((c) => c.length > 0);
  const pollValid = () => usePoll() && pollChoices().length >= 2;
  const remaining = () => limit() - text().length;
  const scheduledAt = () => (scheduleOpen() ? parseScheduledAt(scheduleInput()) : null);
  const canPost = () =>
    !posting() &&
    text().length <= limit() &&
    (text().trim().length > 0 || attached().length > 0 || pollValid() || !!props.renoteId) &&
    (visibility() !== "specified" || recipients().length > 0) &&
    (!scheduleOpen() || (scheduledAt() !== null && isFutureInstant(scheduledAt()!)));

  const toggleAttach = (file: DriveFile) => {
    setAttached((current) =>
      current.some((f) => f.id === file.id)
        ? current.filter((f) => f.id !== file.id)
        : [...current, file],
    );
  };

  const insertEmoji = (emoji: string) => {
    const el = area;
    const current = text();
    if (!el) {
      setText(current + emoji);
    } else {
      const start = el.selectionStart ?? current.length;
      const end = el.selectionEnd ?? current.length;
      setText(current.slice(0, start) + emoji + current.slice(end));
      const pos = start + emoji.length;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    }
  };

  const resetForm = () => {
    setText("");
    setCw("");
    setShowCw(false);
    setVisibility("public");
    setRecipients([]);
    setLocalOnly(false);
    setAttached([]);
    setShowAttach(false);
    setUsePoll(false);
    setChoices(["", ""]);
    setReactionAcceptance("");
    setNoQuote(false);
    setScheduleOpen(false);
    setScheduleInput("");
    setError(null);
    setNotice(null);
    // Collapse the field back to its resting height.
    fitArea();
    if (isCompact()) setExpanded(false);
  };

  const visibleInlineDrafts = () => {
    const all = drafts().length > 0 ? drafts() : listDrafts();
    return draftsScheduledOnly() ? all.filter((d) => (d.scheduledAt ?? "") !== "") : all;
  };

  /** Explicit server copy (§7): local stays the offline cache, the server
   * becomes the source of truth once signed in. 404 keeps it local-only. */
  const saveServerCopy = async () => {
    const p = payload();
    if (!isKeepable(p)) {
      setServerDraftNotice("Nothing worth keeping yet.");
      return;
    }
    try {
      await createServerDraft({
        ...(p.text.trim() ? { text: p.text.trim() } : {}),
        ...(p.cw.trim() ? { cw: p.cw.trim() } : {}),
        visibility: p.visibility,
        ...(p.visibility === "specified" ? { visibleUserIds: p.recipientIds } : {}),
        ...(p.localOnly ? { localOnly: true } : {}),
        ...(p.fileIds && p.fileIds.length > 0 ? { fileIds: p.fileIds } : {}),
        ...(p.replyId ? { replyId: p.replyId } : {}),
        ...(p.renoteId ? { renoteId: p.renoteId } : {}),
        ...(p.scheduledAt ? { scheduledAt: p.scheduledAt } : {}),
        ...(p.reactionAcceptance ? { reactionAcceptance: p.reactionAcceptance } : {}),
        ...(p.noQuote ? { noQuote: true } : {}),
        ...(p.poll ? {
          poll: {
            choices: p.poll.choices,
            multiple: p.poll.multiple,
            ...(p.poll.expiry !== null ? { expiredAfter: p.poll.expiry } : {}),
          },
        } : {}),
      });
      setServerDraftNotice("Saved to the server.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setServerDraftNotice("Server drafts aren't supported here — kept locally.");
      } else {
        setServerDraftNotice(err instanceof Error ? err.message : "Could not save the server copy.");
      }
    }
  };

  const restoreDraft = (draft: Draft) => {
    setMenuOpen(false);
    setText(draft.text);
    setCw(draft.cw);
    setShowCw(draft.cw.length > 0);
    setVisibility(draft.visibility);
    setLocalOnly(draft.localOnly);
    setRecipients((draft.recipients ?? []).map(stubUser));
    setAttached((draft.attachedFiles ?? []).map(stubFile));
    if (draft.poll) {
      setUsePoll(true);
      setChoices(draft.poll.choices.length >= 2 ? draft.poll.choices : ["", ""]);
      setMultiple(draft.poll.multiple);
      setExpiry(draft.poll.expiry);
    } else {
      setUsePoll(false);
    }
    setReactionAcceptance(draft.reactionAcceptance ?? "");
    setNoQuote(draft.noQuote ?? false);
    if (draft.scheduledAt) {
      setScheduleOpen(true);
      setScheduleInput(toLocalInput(draft.scheduledAt));
    } else {
      setScheduleOpen(false);
      setScheduleInput("");
    }
    deleteDraft(draft.id);
    setDrafts(listDrafts());
    setShowDrafts(false);
    setNotice("Draft restored.");
    // The restored text renders next frame — size to it then.
    requestAnimationFrame(() => fitArea());
  };

  const post = async () => {
    if (!canPost()) return;
    setPosting(true);
    setError(null);
    setNotice(null);
    try {
      // Edit mode (§10): PATCH via `notes/edit` on this same surface.
      if (editMode()) {
        try {
          const updated = await editNote(props.editingId!, {
            ...(text().trim() ? { text: text().trim() } : { text: null }),
            ...(showCw() && cw().trim() ? { cw: cw().trim().slice(0, 100) } : { cw: null }),
            visibility: visibility(),
            ...(visibility() === "specified"
              ? { visibleUserIds: recipients().map((r) => r.id) }
              : {}),
            ...(localOnly() ? { localOnly: true } : {}),
            ...(attached().length > 0 ? { fileIds: attached().map((f) => f.id) } : {}),
          });
          resetForm();
          props.onPosted(updated);
        } catch (err) {
          if (isUnsupportedError(err)) {
            props.onEditUnsupported?.();
            setError("Editing isn't supported on this server — use Delete and edit instead.");
          } else {
            setError(err instanceof Error ? err.message : "Could not save the edit.");
          }
        }
        return;
      }
      const at = scheduledAt();
      const body: Record<string, unknown> = {
        visibility: visibility(),
        ...(text().trim() ? { text: text().trim() } : {}),
        ...(showCw() && cw().trim() ? { cw: cw().trim().slice(0, 100) } : {}),
        ...(visibility() === "specified"
          ? { visibleUserIds: recipients().map((r) => r.id) }
          : {}),
        ...(localOnly() ? { localOnly: true } : {}),
        ...(props.replyId ? { replyId: props.replyId } : {}),
        ...(props.renoteId ? { renoteId: props.renoteId } : {}),
        ...(attached().length > 0 ? { fileIds: attached().map((f) => f.id) } : {}),
        ...(reactionAcceptance() !== "" ? { reactionAcceptance: reactionAcceptance() } : {}),
        ...(noQuote() ? { noQuote: true } : {}),
        ...(pollValid()
          ? {
              poll: {
                choices: pollChoices(),
                multiple: multiple(),
                ...(expiry() !== null ? { expiredAfter: expiry() } : {}),
              },
            }
          : {}),
      };
      // Scheduled path (§6): same body through `notes/schedule/create`.
      if (at) {
        try {
          const scheduled = await createScheduledNote({ ...body, scheduledAt: at });
          resetForm();
          setNotice("Note scheduled.");
          props.onScheduled?.(scheduled);
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            setScheduleUnsupported(true);
            setError("Scheduling isn't supported on this server.");
          } else {
            // TOO_MANY_SCHEDULED_NOTES / SCHEDULED_AT_REQUIRED /
            // MUST_BE_IN_FUTURE surface verbatim.
            setError(err instanceof Error ? err.message : "Could not schedule the note.");
          }
        }
        return;
      }
      try {
        const res = await apiCall<CreatedNoteResponse>("notes/create", body);
        // Clear only on success: after a recoverable error the text,
        // settings, and completed uploads are all preserved for retry.
        resetForm();
        props.onPosted(res.createdNote);
      } catch (err) {
        // Quote refusal (§4): keep the text, drop the `renoteId`, show
        // the server reason (mirror the poll/scheduling pattern).
        if (
          body["renoteId"] !== undefined &&
          err instanceof ApiError &&
          (err.code === "QUOTE_DISABLED_FOR_USER" || err.message.includes("QUOTE_DISABLED"))
        ) {
          const { renoteId: _dropped, ...withoutQuote } = body;
          void _dropped;
          try {
            const res = await apiCall<CreatedNoteResponse>("notes/create", withoutQuote);
            resetForm();
            setNotice(err.message);
            props.onPosted(res.createdNote);
            return;
          } catch (retryErr) {
            setError(retryErr instanceof Error ? retryErr.message : "Could not post the note.");
            return;
          }
        }
        setError(err instanceof Error ? err.message : "Could not post the note.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post the note.");
    } finally {
      setPosting(false);
    }
  };

  const placeholder = () =>
    props.replyId ? "Post your reply" : props.renoteId ? "Add a comment…" : "What's happening?";
  const editorPlaceholder = () =>
    props.replyId ? "Write a reply…" : props.renoteId ? "Add a comment…" : "What's happening?";
  const postLabel = () =>
    posting()
      ? editMode()
        ? "Saving…"
        : scheduledAt()
          ? "Scheduling…"
          : "Posting…"
      : editMode()
        ? "Save"
        : props.replyId
          ? "Reply"
          : props.renoteId
            ? "Quote"
            : scheduledAt()
              ? "Schedule"
              : "Post";
  const me = () => auth.me();

  return (
    <Show
      when={!isCompact() || expanded()}
      fallback={
        <div class="composer composer-compact">
          <button
            type="button"
            class="composer-open"
            onClick={() => setExpanded(true)}
            aria-label={placeholder()}
          >
            <Avatar
              url={me()?.avatarUrl ?? null}
              name={me() ? displayNameOf(me()!) : "You"}
            />
            <span>{placeholder()}</span>
          </button>
        </div>
      }
    >
      <div class="composer">
        <Show when={props.replyingTo}>
          <div class="replying-to">
            Replying to <span>{props.replyingTo}</span>
          </div>
        </Show>
        <Show when={editMode()}>
          <div class="replying-to">Editing note</div>
        </Show>
        <div class="composer-main">
          <Avatar
            url={me()?.avatarUrl ?? null}
            name={me() ? displayNameOf(me()!) : "You"}
          />
          <div class="composer-body">
            <textarea
              ref={(el) => {
                area = el;
                // Seed text (draft restore, redraft) sizes after mount.
                requestAnimationFrame(() => fitArea());
              }}
              value={text()}
              onInput={(e) => {
                setText(e.currentTarget.value);
                fitArea();
              }}
              placeholder={editorPlaceholder()}
              maxlength={limit()}
              aria-label={props.replyId ? "Reply text" : props.renoteId ? "Quote comment" : "Note text"}
            />
            <Show when={showCw()}>
              <input
                type="text"
                value={cw()}
                onInput={(e) => setCw(e.currentTarget.value)}
                placeholder="Content warning"
                maxlength={100}
                aria-label="Content warning"
              />
            </Show>
            <Show when={attached().length > 0}>
              <div class="chips">
                <For each={attached()}>
                  {(f) => (
                    <span class="chip">
                      {f.name}
                      <button type="button" onClick={() => toggleAttach(f)} aria-label={`Remove ${f.name}`}>×</button>
                    </span>
                  )}
                </For>
              </div>
            </Show>
            <Show when={showAttach()}>
              <DriveBrowser
                selectMode
                selectedIds={attached().map((f) => f.id)}
                onToggleSelect={toggleAttach}
              />
            </Show>
            <Show when={usePoll()}>
              <div class="field">
                <label>Poll (2–10 options)</label>
                <For each={choices()}>
                  {(choice, i) => (
                    <div class="row">
                      <input
                        type="text"
                        value={choice}
                        onInput={(e) =>
                          setChoices((list) => list.map((c, j) => (j === i() ? e.currentTarget.value : c)))
                        }
                        placeholder={`Option ${i() + 1}`}
                        maxlength={50}
                        aria-label={`Poll option ${i() + 1}`}
                      />
                      <button
                        type="button"
                        disabled={choices().length <= 2}
                        onClick={() => setChoices((list) => list.filter((_, j) => j !== i()))}
                        aria-label={`Remove option ${i() + 1}`}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </For>
                <Show when={choices().length < 10}>
                  <button type="button" onClick={() => setChoices((list) => [...list, ""])}>
                    Add option
                  </button>
                </Show>
                <div class="row">
                  <label>
                    <input type="checkbox" checked={multiple()} onChange={(e) => setMultiple(e.currentTarget.checked)} />
                    Multiple choice
                  </label>
                  <select
                    value={expiry() === null ? "never" : String(expiry())}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      setExpiry(v === "never" ? null : Number(v));
                    }}
                    aria-label="Poll expiry"
                  >
                    <For each={POLL_EXPIRIES}>
                      {(o) => (
                        <option value={o.seconds === null ? "never" : String(o.seconds)}>{o.label}</option>
                      )}
                    </For>
                  </select>
                </div>
              </div>
            </Show>
            <Show when={visibility() === "specified"}>
              <RecipientPicker
                recipients={recipients()}
                onAdd={(u) => setRecipients((r) => (r.some((x) => x.id === u.id) ? r : [...r, u]))}
                onRemove={(id) => setRecipients((r) => r.filter((x) => x.id !== id))}
              />
            </Show>
            <Show when={error()}>
              <div class="err" role="alert">{error()}</div>
            </Show>
            <Show when={notice()}>
              <div class="state" role="status"><p>{notice()}</p></div>
            </Show>
          </div>
        </div>
        <div class="composer-audience">
          <VisibilityPicker value={visibility()} onChange={setVisibility} />
        </div>
        <div class="row toolbar">
          <button
            type="button"
            class="toolbtn"
            onClick={() => setShowAttach((v) => !v)}
            aria-pressed={showAttach()}
            aria-label={attached().length > 0 ? `Attach media (${attached().length} attached)` : "Attach media"}
            title="Attach media"
          >
            <MediaIcon />
            <Show when={attached().length > 0}>
              <span class="toolcount">{attached().length}</span>
            </Show>
          </button>
          <button
            type="button"
            class="toolbtn"
            onClick={() => setUsePoll((v) => !v)}
            aria-pressed={usePoll()}
            aria-label="Add a poll"
            title="Add a poll"
          >
            <PollIcon />
          </button>
          <EmojiPickerButton
            mode="insert"
            triggerClass="toolbtn"
            label="Insert emoji"
            title="Insert emoji"
            onPick={insertEmoji}
          />
          <button
            type="button"
            class="toolbtn tooltext"
            onClick={() => setShowCw((v) => !v)}
            aria-pressed={showCw()}
            aria-label="Content warning"
            title="Content warning"
          >
            CW
          </button>
          <Show when={!editMode()}>
            <span class="vispick-wrap optmenu-wrap">
              <button
                type="button"
                class={advancedActive() ? "toolbtn dot" : "toolbtn"}
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen()}
                aria-label="More options"
                title="More options"
              >
                <MoreIcon />
              </button>
              <Show when={menuOpen()}>
                <div class="vispick-menu optmenu" role="menu" aria-label="More options">
                  <div class="optmenu-head" aria-hidden="true">Who can react</div>
                  <For each={REACTION_OPTIONS}>
                    {(o) => (
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={reactionAcceptance() === o.value}
                        class="vispick-item"
                        onClick={() => setReactionAcceptance(o.value)}
                      >
                        <span class="vispick-text">
                          <span class="vispick-label">{o.label}</span>
                        </span>
                        <span
                          class={reactionAcceptance() === o.value ? "vispick-radio on" : "vispick-radio"}
                          aria-hidden="true"
                        />
                      </button>
                    )}
                  </For>
                  <div class="optmenu-sep" aria-hidden="true" />
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={noQuote()}
                    class="vispick-item"
                    onClick={() => setNoQuote((v) => !v)}
                  >
                    <span class="vispick-text">
                      <span class="vispick-label">Don't let others quote this note</span>
                      <span class="vispick-desc">Quote attempts are refused</span>
                    </span>
                    <span
                      class={noQuote() ? "vispick-radio on" : "vispick-radio"}
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={localOnly()}
                    class="vispick-item"
                    onClick={() => setLocalOnly((v) => !v)}
                  >
                    <span class="vispick-text">
                      <span class="vispick-label">Local only</span>
                      <span class="vispick-desc">Visible only on this server</span>
                    </span>
                    <span
                      class={localOnly() ? "vispick-radio on" : "vispick-radio"}
                      aria-hidden="true"
                    />
                  </button>
                  <div class="optmenu-sep" aria-hidden="true" />
                  <button
                    type="button"
                    class="vispick-item"
                    onClick={() => setScheduleOpen((v) => !v)}
                    aria-expanded={scheduleOpen()}
                    disabled={scheduleUnsupported()}
                    title={scheduleUnsupported() ? "Scheduling isn't supported on this server" : "Schedule this note"}
                  >
                    <span class="vispick-icon" aria-hidden="true">
                      <ScheduleIcon />
                    </span>
                    <span class="vispick-text">
                      <span class="vispick-label">
                        {scheduleOpen() ? "Post now instead" : "Schedule…"}
                      </span>
                      <span class="vispick-desc">
                        {scheduleUnsupported()
                          ? "Not supported on this server"
                          : scheduleOpen() && scheduledAt() && isFutureInstant(scheduledAt()!)
                            ? `Posts ${new Date(scheduledAt()!).toLocaleString()}`
                            : "Post at a later time"}
                      </span>
                    </span>
                  </button>
                  <Show when={scheduleOpen() && !scheduleUnsupported()}>
                    <div class="optmenu-pad">
                      <input
                        type="datetime-local"
                        value={scheduleInput()}
                        onInput={(e) => setScheduleInput(e.currentTarget.value)}
                        aria-label="Scheduled date and time"
                      />
                      <Show when={scheduleInput() && parseScheduledAt(scheduleInput()) === null}>
                        <div class="err" role="alert">Pick a valid date and time.</div>
                      </Show>
                      <Show when={scheduleInput() && parseScheduledAt(scheduleInput()) !== null && !isFutureInstant(parseScheduledAt(scheduleInput())!)}>
                        <div class="err" role="alert">Scheduled time must be in the future.</div>
                      </Show>
                    </div>
                  </Show>
                  <button
                    type="button"
                    class="vispick-item"
                    onClick={() => {
                      const p = payload();
                      if (isKeepable(p)) saveDraft(p);
                      setDrafts(listDrafts());
                      setShowDrafts((v) => !v);
                    }}
                    aria-expanded={showDrafts()}
                  >
                    <span class="vispick-text">
                      <span class="vispick-label">
                        Drafts{drafts().length > 0 || listDrafts().length > 0 ? ` (${drafts().length || listDrafts().length})` : ""}
                      </span>
                      <span class="vispick-desc">Unsent posts on this device</span>
                    </span>
                  </button>
                  <Show when={showDrafts()}>
                    <div class="optmenu-pad">
                      <div class="optrow" role="group" aria-label="Draft filter">
                        <button
                          type="button"
                          class="minibtn"
                          aria-pressed={!draftsScheduledOnly()}
                          onClick={() => setDraftsScheduledOnly(false)}
                        >
                          All
                        </button>
                        <button
                          type="button"
                          class="minibtn"
                          aria-pressed={draftsScheduledOnly()}
                          onClick={() => setDraftsScheduledOnly(true)}
                        >
                          Scheduled
                        </button>
                      </div>
                      <Show
                        when={visibleInlineDrafts().length > 0}
                        fallback={<p class="handle">No drafts yet.</p>}
                      >
                        <For each={visibleInlineDrafts()}>
                          {(draft) => (
                            <div class="draftrow">
                              <button
                                type="button"
                                class="drafttext"
                                onClick={() => restoreDraft(draft)}
                                aria-label={`Restore draft: ${draft.text.slice(0, 60) || "(no text)"}`}
                                title="Restore this draft"
                              >
                                {draft.text.slice(0, 120) || <span class="handle">(no text)</span>}
                                {draft.scheduledAt ? <span class="handle"> · scheduled</span> : null}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  deleteDraft(draft.id);
                                  setDrafts(listDrafts());
                                }}
                                aria-label="Delete this draft"
                                title="Delete this draft"
                              >
                                ×
                              </button>
                            </div>
                          )}
                        </For>
                      </Show>
                    </div>
                  </Show>
                  <button
                    type="button"
                    class="vispick-item"
                    onClick={() => void saveServerCopy()}
                    title="Also keep a copy on the server (when supported)"
                  >
                    <span class="vispick-text">
                      <span class="vispick-label">Save server copy</span>
                      <span class="vispick-desc">Keep this post as a server draft</span>
                    </span>
                  </button>
                  <Show when={serverDraftNotice()}>
                    <p class="handle optmenu-pad" role="status">{serverDraftNotice()}</p>
                  </Show>
                </div>
              </Show>
            </span>
          </Show>
          <span class="spacer" />
          <span class="count">{remaining()}</span>
          <button type="button" class="btn-primary" disabled={!canPost()} onClick={() => void post()}>
            {postLabel()}
          </button>
        </div>
      </div>
    </Show>
  );
}
