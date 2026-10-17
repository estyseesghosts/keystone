// Note "⋯" options menu (docs/note-options.md, slices 1–2).
//
// A portaled flyout in the vispick card language with a User submenu.
// Every post gets the trigger; signed-out viewers see only the actions that
// need no session. Unverified server actions render disabled with a reason;
// rows whose data does not apply are omitted. Delete is own notes only;
// Mute / Mute Boosts / Block are live (relation-driven, Block confirms).
// Rows read `props.note` live: feeds swap notes in place.

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { useLocation, useNavigate } from "@solidjs/router";
import { apiCall, isUnsupportedError } from "../api/client";
import { BACKEND_ID } from "../api/backend";
import {
  blockUser,
  fetchRelation,
  muteRenotes,
  muteUser,
  unblockUser,
  unmuteRenotes,
  unmuteUser,
} from "../api/mutes";
import { cachedRemotePostUrl, resolveRemotePostUrl } from "../api/remotepost";
import { addNoteToClip, listClips, type ClipSummary } from "../api/clips";
import {
  hasTranslatableText,
  isTranslationAvailable,
  retryTranslation,
  translationOutcome,
} from "../api/translate";
import type { Note, UserRelation } from "../api/types";
import { handleOf } from "../api/types";
import {
  AntennaIcon,
  AtIcon,
  BellIcon,
  BellOffIcon,
  BlockIcon,
  ChevRightIcon,
  ClipIcon,
  CopyContentsIcon,
  DeleteIcon,
  ExternalLinkIcon,
  LinkIcon,
  ListIcon,
  MailIcon,
  MemoIcon,
  MoreIcon,
  MuteIcon,
  ProfileLinkIcon,
  RefreshIcon,
  RemoteLinkIcon,
  RemoteUserIcon,
  ReportIcon,
  RepostIcon,
  RssIcon,
  SearchIcon,
  ShareIcon,
  StarIcon,
  TranslateIcon,
  UserIcon,
} from "./icons";

const UNVERIFIED = "Unavailable — endpoint not yet verified";

/** Copy text to the clipboard; falls back to a hidden textarea when the
 * async Clipboard API is missing or refuses (insecure context, denied
 * permission). Resolves false when nothing could be copied. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea copy.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(value, hi));
}

function errorMessage(err: unknown, fallback: string): string {
  if (isUnsupportedError(err)) return "Unavailable on this server";
  return err instanceof Error && err.message ? err.message : fallback;
}

interface ConfirmSpec {
  kind: "delete" | "block" | "report";
  /** Read when the confirmation renders, so it follows the shown note. */
  question: () => string;
  action: string;
  /** Requires a non-empty reason (report). */
  comment?: boolean;
  run: () => void;
}

interface MenuRow {
  id: string;
  label: string | (() => string);
  icon: () => JSX.Element;
  /** Absent: the row is not rendered (data-inapplicable or signed out). */
  when?: () => boolean;
  /** Returns the reason when the row is disabled, null when live. */
  disabled?: () => string | null;
  run?: () => void;
  /** Two-step confirmation shown in place of the row. */
  confirm?: ConfirmSpec;
  /** Shows the submenu chevron (the row opens a flyout or a placeholder). */
  chevron?: boolean;
  /** Expandable rows: whether the inline list is open, and that list. */
  expanded?: () => boolean;
  inline?: () => JSX.Element;
  /** The row opens the User submenu. */
  submenu?: boolean;
}

export interface NoteMenuProps {
  /** The SHOWN note (the caller passes appearNoteOf(note)). */
  note: Note;
  /** Current account, or null when signed out. */
  me: { id: string } | null;
  onChanged?: () => void;
}

type RelationState = {
  userId: string;
  status: "loading" | "ready" | "failed";
  relation: UserRelation | null;
};

export default function NoteMenu(props: NoteMenuProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const [open, setOpen] = createSignal(false);
  const [subOpen, setSubOpen] = createSignal(false);
  const [confirmKind, setConfirmKind] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [reportComment, setReportComment] = createSignal("");
  const [clipOpen, setClipOpen] = createSignal(false);
  const [clipState, setClipState] = createSignal<{
    status: "loading" | "ready" | "empty" | "failed";
    clips: ClipSummary[];
  }>({ status: "loading", clips: [] });
  const [status, setStatus] = createSignal<string | null>(null);
  const [anchor, setAnchor] = createSignal<DOMRect | null>(null);
  const [subAnchor, setSubAnchor] = createSignal<DOMRect | null>(null);
  const [relState, setRelState] = createSignal<RelationState | null>(null);
  const [mainEl, setMainEl] = createSignal<HTMLDivElement>();
  const [subEl, setSubEl] = createSignal<HTMLDivElement>();

  let wrapRef: HTMLSpanElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;
  let userRowRef: HTMLButtonElement | undefined;
  let hoverTimer: number | undefined;
  let closeTimer: number | undefined;
  let statusTimer: number | undefined;
  // Set by the opener: keyboard and click opens move focus into the
  // submenu; pointer hover does not steal focus.
  let focusSubOnOpen = false;

  // Narrow viewports render the submenu inline under its parent row.
  const inlineSub = () => typeof window !== "undefined" && window.innerWidth < 480;

  // ---- Derived note facts (read live from props) ----
  const noteLink = () => `${window.location.origin}/notes/${props.note.id}`;
  const isRemoteNote = () => !!props.note.uri && props.note.uri !== noteLink();
  // The remote post's web page: the packed `url` if sent, else the AP
  // object's `url` once resolved (see api/remotepost.ts), else the AP id,
  // which browsers redirect to the post page.
  const remoteNoteUrl = () =>
    props.note.url ||
    (props.note.uri ? cachedRemotePostUrl(props.note.uri) : null) ||
    props.note.uri ||
    null;
  const isOwnNote = () => !!props.me && props.note.userId === props.me.id;
  const userRemote = () => !!props.note.user.host;
  // Mute / block apply to other accounts, and only for a signed-in viewer.
  const canModerate = () => !!props.me && props.me.id !== props.note.userId;

  // ---- Feedback ----
  // Transient confirmations clear themselves; errors persist until the
  // next action so they are not missed.
  const flash = (message: string, persist = false) => {
    clearTimeout(statusTimer);
    setStatus(message);
    if (!persist) statusTimer = window.setTimeout(() => setStatus(null), 1200);
  };

  const copy = async (text: string, done: string) => {
    flash((await copyText(text)) ? done : "Could not copy");
  };

  // Copies the post's web page when it is known; otherwise the AP id, which
  // is what the remote server gave us.
  const copyRemoteLink = async () => {
    const uri = props.note.uri;
    if (!uri) return;
    const page =
      props.note.url ||
      cachedRemotePostUrl(uri) ||
      (await resolveRemotePostUrl(uri)) ||
      uri;
    await copy(page, "Remote link copied");
  };

  const openRemote = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
    close();
  };

  const share = async () => {
    const url = noteLink();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url });
        close();
        return;
      } catch (err) {
        // The user dismissing the share sheet is not a failure.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    await copy(url, "Link copied");
  };

  // ---- Writes ----
  // Every write runs through `busy` (one at a time) and re-derives its
  // state from the server afterwards.
  const removeNote = async () => {
    if (busy()) return;
    const noteId = props.note.id;
    setBusy(true);
    try {
      await apiCall<undefined>("notes/delete", { noteId });
      const onDetail = location.pathname === `/notes/${noteId}`;
      close();
      if (onDetail) navigate("/");
      props.onChanged?.();
    } catch (err) {
      setConfirmKind(null);
      flash(errorMessage(err, "Could not delete the post."), true);
    } finally {
      setBusy(false);
    }
  };

  // ---- Relation (Mute / Mute Boosts / Block state) ----
  // Loaded when the User submenu opens, for the shown note's author only.
  // Pinetree has no relation/mute endpoints, so nothing is requested there.
  const relationFor = () => {
    const s = relState();
    return s && s.userId === props.note.user.id ? s : null;
  };

  const loadRelation = async (force = false) => {
    const userId = props.note.user.id;
    const current = relState();
    if (!force && current?.userId === userId && current.status !== "failed") return;
    setRelState({ userId, status: "loading", relation: null });
    try {
      const relation = (await fetchRelation(userId)) ?? null;
      if (props.note.user.id !== userId) return;
      setRelState({
        userId,
        status: relation ? "ready" : "failed",
        relation,
      });
    } catch {
      if (props.note.user.id === userId) {
        setRelState({ userId, status: "failed", relation: null });
      }
    }
  };

  const modify = async (action: () => Promise<unknown>) => {
    if (busy()) return;
    setConfirmKind(null);
    setBusy(true);
    try {
      await action();
      await loadRelation(true);
      props.onChanged?.();
    } catch (err) {
      flash(errorMessage(err, "Action failed."), true);
    } finally {
      setBusy(false);
    }
  };

  // Note actions with no local state to re-read (favorite, thread mute,
  // report). A conflict such as "already favorited" surfaces as the server's
  // own message, so nothing is guessed about the current state.
  const noteAction = async (
    action: () => Promise<unknown>,
    done: string,
    notifyChanged = false,
  ) => {
    if (busy()) return;
    setBusy(true);
    try {
      await action();
      flash(done);
      if (notifyChanged) props.onChanged?.();
    } catch (err) {
      flash(errorMessage(err, "Action failed."), true);
    } finally {
      setBusy(false);
    }
  };

  const favorite = () =>
    noteAction(
      () => apiCall<undefined>("notes/favorites/create", { noteId: props.note.id }),
      "Added to favorites",
    );

  const muteThread = () =>
    noteAction(
      () => apiCall<undefined>("notes/thread-muting/create", { noteId: props.note.id }),
      "Thread muted",
      true,
    );

  const reportUser = async () => {
    const comment = reportComment().trim();
    if (!comment || busy()) return;
    const userId = props.note.user.id;
    setConfirmKind(null);
    setBusy(true);
    try {
      await apiCall<undefined>("users/report-abuse", { userId, comment });
      setReportComment("");
      flash("Report sent");
    } catch (err) {
      flash(errorMessage(err, "Could not send the report."), true);
    } finally {
      setBusy(false);
    }
  };

  // Clip row: expands inline to the viewer's clips. Reloaded on each open so
  // a clip created elsewhere shows up.
  const toggleClips = async () => {
    if (clipOpen()) {
      setClipOpen(false);
      return;
    }
    setClipOpen(true);
    setClipState({ status: "loading", clips: [] });
    try {
      const clips = await listClips();
      setClipState({ status: clips.length > 0 ? "ready" : "empty", clips });
    } catch {
      setClipState({ status: "failed", clips: [] });
    }
  };

  const addToClip = (clip: ClipSummary) =>
    noteAction(
      () => addNoteToClip(clip.id, props.note.id),
      `Added to ${clip.name}`,
    );

  // Copy RSS: the author's feed on their instance. Remote authors live on
  // their host; local authors live on this instance, and only when the
  // deployment sets its public address (VITE_KEYSTONE_API_URL). Otherwise
  // the row stays disabled rather than guessing an address.
  const rssUrl = (): string | null => {
    const user = props.note.user;
    if (user.host) return `https://${user.host}/@${user.username}.rss`;
    const base = import.meta.env.VITE_KEYSTONE_API_URL as string | undefined;
    return base && /^https?:\/\//.test(base)
      ? `${base.replace(/\/+$/, "")}/@${user.username}.rss`
      : null;
  };

  // Favorites, thread mute and report: Pinetree is not verified for these,
  // so they stay disabled there.
  const actionDisabled = (): string | null => {
    if (BACKEND_ID === "pinetree") return "Unavailable on Pinetree";
    if (busy()) return "Working…";
    return null;
  };

  const modDisabled = (): string | null => {
    if (BACKEND_ID === "pinetree") return "Unavailable on Pinetree";
    if (busy()) return "Working…";
    const s = relationFor();
    if (!s || s.status === "loading") return "Loading…";
    if (s.status === "failed") return "Unavailable — relation lookup failed";
    return null;
  };

  // ---- Row definitions (built in setup; every read is deferred) ----
  const noteSections: MenuRow[][] = [
    [
      {
        id: "copy-contents",
        label: "Copy contents",
        icon: () => <CopyContentsIcon />,
        disabled: () => (props.note.text ? null : "Nothing to copy"),
        run: () => void copy(props.note.text ?? "", "Copied"),
      },
      {
        id: "copy-link",
        label: "Copy link",
        icon: () => <LinkIcon />,
        run: () => void copy(noteLink(), "Link copied"),
      },
      {
        id: "copy-remote-link",
        label: "Copy remote link",
        icon: () => <RemoteLinkIcon />,
        when: () => isRemoteNote(),
        run: () => void copyRemoteLink(),
      },
      {
        id: "view-remote",
        label: "View on remote instance",
        icon: () => <ExternalLinkIcon />,
        when: () => isRemoteNote() && !!remoteNoteUrl(),
        run: () => openRemote(remoteNoteUrl() ?? ""),
      },
      {
        id: "share",
        label: "Share",
        icon: () => <ShareIcon />,
        run: () => void share(),
      },
    ],
    [
      {
        id: "translate",
        label: "Translate",
        icon: () => <TranslateIcon />,
        // Hidden once a translation is on screen. Translation is shown
        // automatically when the server offers it; this row retries a
        // failed attempt for posts that still have no translation.
        when: () =>
          isTranslationAvailable() &&
          hasTranslatableText(props.note.text) &&
          translationOutcome(props.note.id) !== "loaded",
        disabled: () =>
          translationOutcome(props.note.id) === "unchanged"
            ? "Already in your language"
            : null,
        run: () => retryTranslation(props.note.id),
      },
      {
        id: "mute-thread",
        label: "Mute thread",
        icon: () => <BellOffIcon />,
        // `notes/mute` does not exist; the thread endpoint is
        // `notes/thread-muting/*`. Wired without a read-back of state.
        when: () => !!props.me,
        disabled: actionDisabled,
        run: () => void muteThread(),
      },
      {
        id: "favorites",
        label: "Add to favorites",
        icon: () => <StarIcon />,
        when: () => !!props.me,
        disabled: actionDisabled,
        run: () => void favorite(),
      },
      {
        id: "clip",
        label: "Clip",
        icon: () => <ClipIcon />,
        chevron: true,
        when: () => !!props.me,
        disabled: actionDisabled,
        run: () => void toggleClips(),
        expanded: () => clipOpen(),
        inline: () => clipList(),
      },
      {
        id: "user",
        label: "User",
        icon: () => <UserIcon />,
        chevron: true,
        submenu: true,
      },
    ],
    [
      {
        id: "report",
        label: "Report",
        icon: () => <ReportIcon />,
        // Reports the author; a reason is required before it is sent.
        when: () => canModerate(),
        disabled: actionDisabled,
        run: () => {
          setReportComment("");
          setConfirmKind("report");
        },
        confirm: {
          kind: "report",
          question: () => `Report ${handleOf(props.note.user)}?`,
          action: "Report",
          comment: true,
          run: () => void reportUser(),
        },
      },
      {
        id: "delete",
        label: "Delete",
        icon: () => <DeleteIcon />,
        when: () => isOwnNote(),
        run: () => setConfirmKind("delete"),
        confirm: {
          kind: "delete",
          question: () => "Delete this post?",
          action: "Delete",
          run: () => void removeNote(),
        },
      },
    ],
  ];

  const userSections: MenuRow[][] = [
    [
      {
        id: "copy-username",
        label: "Copy username",
        icon: () => <AtIcon />,
        run: () => void copy(handleOf(props.note.user), "Username copied"),
      },
      {
        id: "copy-profile-url",
        label: "Copy profile URL",
        icon: () => <ProfileLinkIcon />,
        run: () =>
          void copy(
            `${window.location.origin}/users/${props.note.user.id}`,
            "Profile URL copied",
          ),
      },
      {
        id: "view-remote-user",
        label: "View on remote instance",
        icon: () => <RemoteUserIcon />,
        // Feed notes carry UserLite (no profile URL). Never guess one from
        // host + username: the row stays disabled until a URL is loaded.
        when: () => userRemote(),
        disabled: () => "Unavailable — remote profile URL not in this post's data",
      },
    ],
    [
      {
        id: "rss",
        label: "Copy RSS",
        icon: () => <RssIcon />,
        disabled: () =>
          rssUrl() ? null : "Unavailable — this instance's public address is not configured",
        run: () => {
          const url = rssUrl();
          if (url) void copy(url, "RSS link copied");
        },
      },
      {
        id: "search-notes",
        label: "Search this user's notes",
        icon: () => <SearchIcon />,
        disabled: () => "Unavailable — note search is restricted on these servers",
      },
    ],
    [
      {
        id: "memo",
        label: "Edit memo",
        icon: () => <MemoIcon />,
        disabled: () => UNVERIFIED,
      },
      {
        id: "add-list",
        label: "Add to list",
        icon: () => <ListIcon />,
        chevron: true,
        disabled: () => "Unavailable — user lists not yet supported",
      },
      {
        id: "add-antenna",
        label: "Add to antenna",
        icon: () => <AntennaIcon />,
        chevron: true,
        disabled: () => "Unavailable — antenna source not yet supported",
      },
      {
        id: "notify",
        label: "Notify about new notes",
        icon: () => <BellIcon />,
        disabled: () => UNVERIFIED,
      },
      {
        id: "dm",
        label: "Send a message",
        icon: () => <MailIcon />,
        disabled: () => "Unavailable — no messaging in Keystone yet",
      },
    ],
    [
      {
        id: "mute",
        label: () => (relationFor()?.relation?.isMuted ? "Unmute" : "Mute"),
        icon: () => <MuteIcon />,
        when: () => canModerate(),
        disabled: modDisabled,
        run: () => {
          const muted = relationFor()?.relation?.isMuted;
          const userId = props.note.user.id;
          void modify(() => (muted ? unmuteUser(userId) : muteUser(userId)));
        },
      },
      {
        id: "mute-boosts",
        label: () =>
          relationFor()?.relation?.isRenoteMuted ? "Unmute Boosts" : "Mute Boosts",
        icon: () => <RepostIcon />,
        when: () => canModerate(),
        disabled: modDisabled,
        run: () => {
          const muted = relationFor()?.relation?.isRenoteMuted;
          const userId = props.note.user.id;
          void modify(() => (muted ? unmuteRenotes(userId) : muteRenotes(userId)));
        },
      },
      {
        id: "block",
        label: () => (relationFor()?.relation?.isBlocking ? "Unblock" : "Block"),
        icon: () => <BlockIcon />,
        when: () => canModerate(),
        disabled: modDisabled,
        run: () => {
          const userId = props.note.user.id;
          if (relationFor()?.relation?.isBlocking) {
            void modify(() => unblockUser(userId));
            return;
          }
          // Blocking is the consequential direction: confirm first.
          setConfirmKind("block");
        },
        confirm: {
          kind: "block",
          question: () => `Block ${handleOf(props.note.user)}?`,
          action: "Block",
          run: () => {
            const userId = props.note.user.id;
            void modify(() => blockUser(userId));
          },
        },
      },
      {
        id: "refresh-remote",
        label: "Refresh remote data",
        icon: () => <RefreshIcon />,
        when: () => userRemote(),
        disabled: () => UNVERIFIED,
      },
    ],
  ];

  // ---- Submenu open/close ----
  const clearTimers = () => {
    clearTimeout(hoverTimer);
    clearTimeout(closeTimer);
  };

  const closeSub = (returnFocus = false) => {
    clearTimers();
    setSubOpen(false);
    setSubAnchor(null);
    if (returnFocus) userRowRef?.focus();
  };

  const openSub = (focus: boolean) => {
    if (!userRowRef) return;
    clearTimeout(closeTimer);
    setSubAnchor(userRowRef.getBoundingClientRect());
    if (props.me && BACKEND_ID !== "pinetree") void loadRelation();
    focusSubOnOpen = focus;
    setSubOpen(true);
  };

  const scheduleSubClose = () => {
    clearTimeout(hoverTimer);
    closeTimer = window.setTimeout(() => closeSub(), 250);
  };

  const onUserEnter = () => {
    clearTimeout(closeTimer);
    clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => openSub(false), 150);
  };

  // Leaving the User row closes the submenu unless the pointer reaches it
  // within the grace period (its own enter handler cancels the close).
  const onUserLeave = () => {
    clearTimeout(hoverTimer);
    scheduleSubClose();
  };

  const focusFirstIn = (el: HTMLElement | undefined) => {
    el?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  };

  // ---- Menu open/close ----
  const close = (returnFocus = false) => {
    closeSub();
    clearTimeout(statusTimer);
    setOpen(false);
    setConfirmKind(null);
    setClipOpen(false);
    setAnchor(null);
    setStatus(null);
    if (returnFocus) triggerRef?.focus();
  };

  const toggle = () => {
    if (open()) {
      close();
      return;
    }
    if (triggerRef) setAnchor(triggerRef.getBoundingClientRect());
    // Resolve the remote page now, so "View" and "Copy" are synchronous by
    // the time the viewer clicks (opening a window after an await can be
    // blocked as a popup).
    if (props.note.uri && isRemoteNote()) void resolveRemotePostUrl(props.note.uri);
    // Drop any late message from the previous open.
    setStatus(null);
    setOpen(true);
  };

  // Placement: measured after render. Opens above the trigger, or below
  // it when the trigger sits in the top ~35% of the viewport; right-aligned
  // to the trigger and clamped inside the viewport. Reads confirmKind so a
  // confirmation that grows the menu is placed again.
  createEffect(() => {
    const el = mainEl();
    const a = anchor();
    confirmKind();
    clipState();
    clipOpen();
    if (!el || !a) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const below = a.top < vh * 0.35;
    const top = below ? a.bottom + 6 : a.top - 6 - h;
    el.style.top = `${clamp(top, 8, vh - 8 - h)}px`;
    el.style.left = `${clamp(a.right - w, 8, vw - 8 - w)}px`;
  });

  // Submenu placement: beside the User row, flipped to the left edge when
  // it would overflow the right edge, clamped vertically. Reads relState and
  // confirmKind so the submenu is placed again when its labels or a block
  // confirmation change its size. Inline (narrow) mode is laid out by the
  // menu itself.
  createEffect(() => {
    const el = subEl();
    const a = subAnchor();
    relState();
    confirmKind();
    if (!el || !a || inlineSub()) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const right = a.right + 6;
    const left = right + w > vw - 8 ? a.left - 6 - w : right;
    el.style.left = `${clamp(left, 8, vw - 8 - w)}px`;
    el.style.top = `${clamp(a.top, 8, vh - 8 - h)}px`;
  });

  // Focus moves into the menu when it opens (first enabled row) and into
  // the submenu when it is opened from the keyboard or by click.
  createEffect(() => {
    const el = mainEl();
    if (!open() || !el) return;
    focusFirstIn(el);
  });

  createEffect(() => {
    const el = subEl();
    if (!subOpen() || !el || !focusSubOnOpen) return;
    focusSubOnOpen = false;
    focusFirstIn(el);
  });

  // Dismiss listeners live only while the menu is open. Clicks and focus
  // inside the trigger wrap or either menu are not outside interactions.
  // Scrolling inside the menu itself is allowed; any other scroll or a
  // resize closes it (the flyout is viewport-fixed and would go stale).
  createEffect(() => {
    if (!open()) return;
    const inside = (target: EventTarget | null) => {
      const node = target as Node | null;
      if (!node) return false;
      return (
        !!wrapRef?.contains(node) ||
        !!mainEl()?.contains(node) ||
        !!subEl()?.contains(node)
      );
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!inside(e.target)) close();
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!inside(e.target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && subOpen()) {
        e.preventDefault();
        closeSub(true);
        return;
      }
      if (e.key !== "Escape") return;
      if (subOpen()) {
        closeSub(true);
      } else {
        close(true);
      }
    };
    const onScroll = (e: Event) => {
      if (inside(e.target)) return;
      close();
    };
    const onResize = () => close();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    });
  });

  onCleanup(() => {
    clearTimers();
    clearTimeout(statusTimer);
  });

  // ---- Rendering ----
  const clipNotice = (text: string) => (
    <button
      type="button"
      role="menuitem"
      class="vispick-item notemenu-item"
      disabled
      aria-disabled="true"
      title={text}
    >
      <span class="vispick-text">
        <span class="vispick-label">{text}</span>
      </span>
    </button>
  );

  const clipList = () => (
    <div class="notemenu-inline" role="group" aria-label="Clips">
      <Show
        when={clipState().status === "ready"}
        fallback={clipNotice(
          clipState().status === "loading"
            ? "Loading clips…"
            : clipState().status === "failed"
              ? "Unavailable — clips could not be loaded"
              : "No clips yet",
        )}
      >
        <For each={clipState().clips}>
          {(clip) => (
            <button
              type="button"
              role="menuitem"
              class="vispick-item notemenu-item"
              disabled={busy()}
              onClick={() => void addToClip(clip)}
            >
              <span class="vispick-text">
                <span class="vispick-label">{clip.name}</span>
              </span>
            </button>
          )}
        </For>
      </Show>
    </div>
  );

  const confirmBlock = (c: ConfirmSpec) => (
    <div class="notemenu-confirm" role="group" aria-label={c.question()}>
      <span class="notemenu-confirm-question">{c.question()}</span>
      <Show when={c.comment}>
        <textarea
          class="notemenu-confirm-comment"
          rows={3}
          maxLength={1000}
          placeholder="Reason (required)"
          aria-label="Report reason"
          value={reportComment()}
          onInput={(e) => setReportComment(e.currentTarget.value)}
        />
      </Show>
      <div class="notemenu-confirm-actions">
        <button
          type="button"
          role="menuitem"
          class="notemenu-confirm-yes"
          disabled={busy() || (!!c.comment && reportComment().trim() === "")}
          onClick={() => c.run()}
        >
          {c.action}
        </button>
        <button
          type="button"
          role="menuitem"
          class="notemenu-confirm-no"
          onClick={() => setConfirmKind(null)}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  const renderRow = (row: MenuRow) => (
    <Show when={!row.when || row.when()}>
      <Show
        when={!(row.confirm && confirmKind() === row.confirm.kind)}
        fallback={row.confirm ? confirmBlock(row.confirm) : null}
      >
        <button
          type="button"
          role="menuitem"
          class="vispick-item notemenu-item"
          ref={(el) => {
            if (row.submenu) userRowRef = el;
          }}
          disabled={!!row.disabled?.()}
          aria-disabled={row.disabled?.() ? "true" : undefined}
          aria-haspopup={row.submenu ? "menu" : undefined}
          aria-expanded={
            row.submenu ? subOpen() : row.expanded ? row.expanded() : undefined
          }
          title={row.disabled?.() ?? undefined}
          onMouseEnter={row.submenu ? onUserEnter : undefined}
          onMouseLeave={row.submenu ? onUserLeave : undefined}
          onKeyDown={
            row.submenu
              ? (e: KeyboardEvent) => {
                  if (e.key === "ArrowRight") {
                    e.preventDefault();
                    openSub(true);
                  }
                }
              : undefined
          }
          onClick={() => {
            if (row.disabled?.()) return;
            if (row.submenu) {
              // A hover-opened submenu is kept; a click moves focus into it.
              if (subOpen()) focusFirstIn(subEl());
              else openSub(true);
              return;
            }
            row.run?.();
          }}
        >
          <span class="vispick-icon">{row.icon()}</span>
          <span class="vispick-text">
            <span class="vispick-label">
              {typeof row.label === "function" ? row.label() : row.label}
            </span>
          </span>
          <Show when={row.chevron}>
            <span class="notemenu-item-right">
              <ChevRightIcon />
            </span>
          </Show>
        </button>
        <Show when={row.expanded?.()}>{row.inline?.()}</Show>
        <Show when={row.submenu && inlineSub() && subOpen()}>
          <div
            ref={setSubEl}
            class="notemenu-inline"
            role="group"
            aria-label="User options"
            onMouseEnter={() => clearTimeout(closeTimer)}
            onMouseLeave={scheduleSubClose}
          >
            <For each={userSections}>{(section, i) => renderSection(section, i())}</For>
          </div>
        </Show>
      </Show>
    </Show>
  );

  const renderSection = (section: MenuRow[], index: number) => (
    <>
      <Show when={index > 0}>
        <div class="notemenu-sep" role="separator" />
      </Show>
      <For each={section}>{(row) => renderRow(row)}</For>
    </>
  );

  return (
    <span class="notemenu-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        class="action"
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-label="More options"
        title="More options"
        onClick={toggle}
      >
        <MoreIcon />
      </button>

      <Show when={open()}>
        <Portal>
          <div
            ref={setMainEl}
            class="vispick-menu notemenu"
            role="menu"
            aria-label="Post options"
          >
            <For each={noteSections}>{(section, i) => renderSection(section, i())}</For>
            <Show when={status()}>
              <div class="notemenu-status" aria-live="polite">{status()}</div>
            </Show>
          </div>
        </Portal>
      </Show>

      <Show when={open() && subOpen() && !inlineSub()}>
        <Portal>
          <div
            ref={setSubEl}
            class="vispick-menu notemenu notemenu-submenu"
            role="menu"
            aria-label="User options"
            onMouseEnter={() => clearTimeout(closeTimer)}
            onMouseLeave={scheduleSubClose}
          >
            <For each={userSections}>{(section, i) => renderSection(section, i())}</For>
          </div>
        </Portal>
      </Show>
    </span>
  );
}
