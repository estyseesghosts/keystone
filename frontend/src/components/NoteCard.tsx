import { A, useNavigate } from "@solidjs/router";
import { createEffect, onCleanup, createMemo, createSignal, For, Show } from "solid-js";
import type { Note, UserLite } from "../api/types";
import {
  appearNoteOf,
  displayNameOf,
  handleOf,
  hasRealDisplayName,
  headNameOf,
  isPureRenote,
  reactionAcceptanceLabel,
} from "../api/types";
import { effectiveMyReaction } from "../api/myReactions";
import { replyParentId, replyParentNote } from "../api/thread";
import NoteBody, { Avatar } from "./NoteBody";
import UserHover from "./UserHoverCard";
import TagBubble from "./TagBubble";
import { parseTagBlocks } from "../api/tags";
import { formatTime } from "./time";
import { HeartIcon, ReplyIcon, RepostIcon } from "./icons";
import { LikeButton, ReactionChips } from "./ReactionPicker";
import { DisplayName, EmojiPickerButton } from "./EmojiPicker";
import { isHeartReaction } from "../api/emoji";
import { useAuth } from "../state/auth";
import NoteMenu from "./NoteMenu";

export { formatTime } from "./time";

/** Repost banner naming every collapsed renoter: "xx reposted",
 * "xx and yy reposted", "xx, yy and zz reposted",
 * "xx, yy, zz and N others reposted". Names link to profiles. */
function RepostBanner(props: { users: UserLite[] }) {
  const shown = createMemo(() => props.users.slice(0, 3));
  const extra = createMemo(() => props.users.length - shown().length);
  const separator = (i: number) => {
    if (i === 0) return "";
    if (extra() === 0 && i === shown().length - 1) return " and ";
    return ", ";
  };
  return (
    <div class="renote-banner">
      <RepostIcon />
      <For each={shown()}>
        {(u, i) => (
          <>
            {separator(i())}
            <A class="namelink" href={`/users/${u.id}`}>
              <span class="name"><DisplayName name={headNameOf(u)} packed={u.emojis} host={u.host} /></span>
            </A>
          </>
        )}
      </For>
      {extra() > 0 ? (
        <span>and {extra()} {extra() === 1 ? "other" : "others"} reposted</span>
      ) : (
        <span>reposted</span>
      )}
    </div>
  );
}

export interface NoteCardProps {
  note: Note;
  /** Set the viewer's reaction: `reaction` for the desired end state
   * (the caller deletes-then-creates as needed — the server rejects
   * reacting twice), null to remove. Callers pass the displayed note. */
  onToggleReaction?: (note: Note, reaction: string | null) => void;
  onRepost?: (note: Note) => void;
  onUnrepost?: (note: Note) => void;
  /** Open the quote composer for the note. Drives the renote menu's
   * "Quote" item; the card never posts by itself. */
  onQuote?: (note: Note) => void;
  reposting?: boolean;
  reposted?: boolean;
  /** All renoters to name in the repost banner when the feed collapsed
   * several reposts of one original (first wrapper shown). Absent for
   * single reposts and non-feed contexts — the banner falls back to the
   * wrapper's own author. */
  renoters?: UserLite[];
  onChanged?: () => void;
  detail?: boolean;
  /** Fold long post text in feeds (default true). The note-detail route
   * passes false for full text. Depth > 0 (quoted embeds) never folds. */
  foldText?: boolean;
  /** Show the "Replying to" line for replies (default true). Thread
   * contexts (detail ancestors/main, nested reply branches) hide it —
   * the tree already shows the parent — while every feed leaves it on
   * so a reply never reads as a loose post. */
  showReplyContext?: boolean;
  /** Soft-mute forced warning (§13): the note matched `mutedWords` and
   * has no CW of its own, so the feed renders this badge above the body
   * (body kept — hard matches hide the row instead). */
  forcedMute?: boolean;
}
export default function NoteCard(props: NoteCardProps) {
  const loggedIn = () => props.onToggleReaction !== undefined;
  // Retweet-style display for pure reposts: the renoted original is the
  // shown note, with a banner naming the renoter. Quotes render as their
  // own note (NoteBody embeds the original). Every action below targets
  // the shown note — the server rejects renoting/replying to a
  // pure-renote wrapper, so handlers receive the original there.
  const pure = () => isPureRenote(props.note);
  const shown = () => appearNoteOf(props.note);
  const navigate = useNavigate();
  const auth = useAuth();
  // Clicking the post opens its detail view, like the reference client —
  // except on the detail route itself (already there). Clicks that start
  // in interactive content (links, buttons, inputs, media controls,
  // menus, dialogs) keep their own behavior, as do text selections and
  // modified clicks. Keyboard users already have the time, reply-count,
  // and Open-post links, so the card takes no tab stop of its own.
  const openDetail = (e: MouseEvent) => {
    if (props.detail) return;
    if (e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (
      target?.closest?.(
        'a,button,input,textarea,select,audio,video,[role="menu"],[role="dialog"]',
      )
    )
      return;
    try {
      if (window.getSelection()?.toString()) return;
    } catch {
      // Selection unreadable: fall through to navigation.
    }
    navigate(`/notes/${shown().id}`);
  };
  const [menuOpen, setMenuOpen] = createSignal(false);
  // Tag bubble from the FULL original text — never from a server
  // translation (the translator mangles tags). Lone hashtags stay inline
  // and out of the bubble; only pruned block tags are listed.
  const tags = createMemo(() => parseTagBlocks(shown().text ?? ""));
  // Reply context for feeds: the displayed note's `replyId` is the source
  // of truth (never a client thread id). The packed one-level `reply`
  // names the parent when the server included it; otherwise the line
  // still links to the parent id so the reply never reads as a loose
  // post. Thread contexts opt out via `showReplyContext={false}`.
  const parentId = createMemo(() => replyParentId(props.note));
  const packedParent = createMemo(() => replyParentNote(props.note));
  const showContext = () => props.showReplyContext !== false && parentId() !== null;

  // The renote menu closes on outside click or Escape.
  createEffect(() => {
    if (!menuOpen()) return;
    const onDocClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.(".renotewrap")) setMenuOpen(false);
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

  return (
    <article
      class={props.detail ? "note" : "note note-openable"}
      onClick={openDetail}
    >
      <Show when={pure()}>
        <RepostBanner
          users={
            props.renoters && props.renoters.length > 0
              ? props.renoters
              : [props.note.user]
          }
        />
      </Show>
      <UserHover user={shown().user}>
        <A
          class="avatarlink"
          href={`/users/${shown().user.id}`}
          aria-label={`Open profile of ${displayNameOf(shown().user)}`}
        >
          <Avatar url={shown().user.avatarUrl} name={displayNameOf(shown().user)} />
        </A>
      </UserHover>
      <div class="note-main">
        <Show when={showContext()}>
          <div class="reply-context">
            <span>Replying to </span>
            <Show
              when={packedParent()}
              fallback={
                <A
                  class="reply-context-link"
                  href={`/notes/${parentId()}`}
                  aria-label="Open parent post"
                >
                  a post
                </A>
              }
            >
              {(parent) => (
                <A
                  class="reply-context-link"
                  href={`/notes/${parentId()}`}
                  aria-label={`Open parent post by ${handleOf(parent().user)}`}
                  title={handleOf(parent().user)}
                >
                  <span class="name"><DisplayName name={headNameOf(parent().user)} packed={parent().user.emojis} host={parent().user.host} /></span>
                  <Show when={hasRealDisplayName(parent().user)}>
                    <span class="handle">{handleOf(parent().user)}</span>
                  </Show>
                </A>
              )}
            </Show>
          </div>
        </Show>
        <div class="note-head">
          <UserHover user={shown().user}>
            <A class="namelink" href={`/users/${shown().user.id}`}>
              <span class="name"><DisplayName name={headNameOf(shown().user)} packed={shown().user.emojis} host={shown().user.host} /></span>
              <Show when={hasRealDisplayName(shown().user)}>
                <span class="handle">{handleOf(shown().user)}</span>
              </Show>
            </A>
          </UserHover>
          <Show
            when={!props.detail}
            fallback={<span class="time">{formatTime(shown().createdAt)}</span>}
          >
            <A class="time" href={`/notes/${shown().id}`}>
              {formatTime(shown().createdAt)}
            </A>
          </Show>
          <span class="spacer" aria-hidden="true" />
          <Show when={tags().blocks.length > 0}>
            <TagBubble tags={tags().blockedTags} />
          </Show>
        </div>

        <Show when={props.forcedMute}>
          <div class="handle" title="This note matches one of your muted words">
            Muted word — content shown
          </div>
        </Show>
        <NoteBody note={shown()} canVote={loggedIn()} onChanged={props.onChanged} foldText={props.foldText} />

        <Show when={reactionAcceptanceLabel(shown().reactionAcceptance)}>
          {(label) => (
            <div class="handle" title="This note limits who can react">
              Reactions: {label()}
            </div>
          )}
        </Show>

        <ReactionChips
          note={shown()}
          onToggle={props.onToggleReaction ? (reaction) => props.onToggleReaction?.(shown(), reaction) : undefined}
        />

        <div class="noteactions">
          {/* The detail route renders counts, not self-links: the router
            marks a link to the current page active, which stuck the
            reply button highlighted on every opened post. */}
          <Show
            when={!props.detail}
            fallback={
              <span class="action" aria-label={`Replies: ${shown().repliesCount}`}>
                <ReplyIcon /> {shown().repliesCount}
              </span>
            }
          >
            <A class="action" href={`/notes/${shown().id}`} aria-label="Open note">
              <ReplyIcon /> {shown().repliesCount}
            </A>
          </Show>
          <Show when={props.onRepost} fallback={
            <span class="action" aria-label="Reposts">
              <RepostIcon /> {shown().renoteCount}
            </span>
          }>
            <div class="renotewrap">
              <button
                type="button"
                class={props.reposted ? "action active" : "action"}
                disabled={props.reposting}
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen()}
                aria-label={props.reposted ? "Repost options (already reposted)" : "Repost options"}
                title="Repost"
              >
                <RepostIcon /> {shown().renoteCount}
              </button>
              <Show when={menuOpen()}>
                <div class="renotemenu" role="menu" aria-label="Repost options">
                  <Show when={props.reposted} fallback={
                    <button
                      type="button"
                      role="menuitem"
                      disabled={props.reposting}
                      onClick={() => { setMenuOpen(false); props.onRepost?.(shown()); }}
                    >
                      Repost
                    </button>
                  }>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={props.reposting}
                      aria-pressed="true"
                      onClick={() => { setMenuOpen(false); props.onUnrepost?.(shown()); }}
                    >
                      Undo repost
                    </button>
                  </Show>
                  <Show when={props.onQuote}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { setMenuOpen(false); props.onQuote?.(shown()); }}
                    >
                      Quote
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
          </Show>
          <Show when={props.onToggleReaction} fallback={
            <span class="action" aria-label="Likes">
              <HeartIcon filled={isHeartReaction(effectiveMyReaction(shown()))} /> {shown().reactionCount}
            </span>
          }>
            <LikeButton
              note={shown()}
              onReact={(reaction) => props.onToggleReaction?.(shown(), reaction)}
            />
            <EmojiPickerButton
              mode="reaction"
              triggerClass="action"
              label="Emoji reaction"
              title="Emoji reaction"
              myReaction={shown().myReaction}
              onPick={(reaction) => props.onToggleReaction?.(shown(), reaction)}
              onUnreact={() => props.onToggleReaction?.(shown(), null)}
            />
          </Show>
          {/* Every post gets the options menu. Signed-out viewers get only
            the actions that need no session (mute/block/delete are hidden). */}
          <NoteMenu note={shown()} me={auth.me()} onChanged={props.onChanged} />
        </div>
      </div>
    </article>
  );
}
