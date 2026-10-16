import { A } from "@solidjs/router";
import { createEffect, onCleanup, createMemo, createSignal, For, Show } from "solid-js";
import type { Note, UserLite } from "../api/types";
import { appearNoteOf, displayNameOf, handleOf, isPureRenote } from "../api/types";
import NoteBody, { Avatar } from "./NoteBody";
import { HeartIcon, ReplyIcon, RepostIcon } from "./icons";
import { EmojiButton, LikeButton, ReactionChips, HEART_REACTION, isHeartReaction } from "./ReactionPicker";

function formatTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return new Date(t).toLocaleDateString();
}

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
              <span class="name">{displayNameOf(u)}</span>
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
  reacting?: boolean;
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
  const [menuOpen, setMenuOpen] = createSignal(false);

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
    <article class="note">
      <Show when={pure()}>
        <RepostBanner
          users={
            props.renoters && props.renoters.length > 0
              ? props.renoters
              : [props.note.user]
          }
        />
      </Show>
      <A
        class="avatarlink"
        href={`/users/${shown().user.id}`}
        aria-label={`Open profile of ${displayNameOf(shown().user)}`}
      >
        <Avatar url={shown().user.avatarUrl} name={displayNameOf(shown().user)} />
      </A>
      <div class="note-main">
        <div class="note-head">
          <A class="namelink" href={`/users/${shown().user.id}`}>
            <span class="name">{displayNameOf(shown().user)}</span>
            <span class="handle">{handleOf(shown().user)}</span>
          </A>
          <A class="time" href={`/notes/${shown().id}`}>
            {formatTime(shown().createdAt)}
          </A>
        </div>

        <NoteBody note={shown()} canVote={loggedIn()} onChanged={props.onChanged} />

        <ReactionChips
          note={shown()}
          onToggle={props.onToggleReaction ? (reaction) => props.onToggleReaction?.(shown(), reaction) : undefined}
          disabled={props.reacting}
        />

        <div class="noteactions">
          <A class="action" href={`/notes/${shown().id}`} aria-label="Open note">
            <ReplyIcon /> {shown().repliesCount}
          </A>
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
              <HeartIcon filled={isHeartReaction(shown().myReaction)} /> {shown().reactionCount}
            </span>
          }>
            <LikeButton
              note={shown()}
              disabled={props.reacting}
              onToggle={() => props.onToggleReaction?.(
                shown(),
                isHeartReaction(shown().myReaction) ? null : HEART_REACTION,
              )}
            />
            <EmojiButton
              myReaction={shown().myReaction}
              disabled={props.reacting}
              onPick={(reaction) => props.onToggleReaction?.(shown(), reaction)}
              onUnreact={() => props.onToggleReaction?.(shown(), null)}
            />
          </Show>
        </div>
      </div>
    </article>
  );
}
