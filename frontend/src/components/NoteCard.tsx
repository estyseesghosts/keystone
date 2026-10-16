import { A } from "@solidjs/router";
import { createEffect, onCleanup, createSignal, Show } from "solid-js";
import type { Note } from "../api/types";
import { appearNoteOf, displayNameOf, handleOf, isPureRenote } from "../api/types";
import NoteBody, { Avatar } from "./NoteBody";
import { HeartIcon, ReplyIcon, RepostIcon } from "./icons";
import ReactionPicker from "./ReactionPicker";

function formatTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return new Date(t).toLocaleDateString();
}

export interface NoteCardProps {
  note: Note;
  /** Reaction toggle: `reaction` set to add, null to remove. */
  onToggleReaction?: (note: Note, reaction: string | null) => void;
  reacting?: boolean;
  onRepost?: (note: Note) => void;
  onUnrepost?: (note: Note) => void;
  /** Open the quote composer for the note. Drives the renote menu's
   * "Quote" item; the card never posts by itself. */
  onQuote?: (note: Note) => void;
  reposting?: boolean;
  reposted?: boolean;
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
        <div class="renote-banner">
          <RepostIcon />
          <A class="namelink" href={`/users/${props.note.user.id}`}>
            <span class="name">{displayNameOf(props.note.user)}</span>
          </A>
          <span>reposted</span>
        </div>
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
            <span class="action" aria-label="Reactions">
              <HeartIcon filled={shown().myReaction != null} /> {shown().reactionCount}
            </span>
          }>
            <ReactionPicker
              counts={shown().reactions}
              myReaction={shown().myReaction}
              disabled={props.reacting}
              onPick={(reaction) => props.onToggleReaction?.(shown(), reaction)}
              onUnreact={() => props.onToggleReaction?.(shown(), null)}
            />
            <span class="action" aria-label="Reaction count">{shown().reactionCount}</span>
          </Show>
        </div>
      </div>
    </article>
  );
}
