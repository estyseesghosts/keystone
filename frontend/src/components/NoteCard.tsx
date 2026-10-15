import { A } from "@solidjs/router";
import { Show } from "solid-js";
import type { Note } from "../api/types";
import { displayNameOf, handleOf } from "../api/types";
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
  reposting?: boolean;
  reposted?: boolean;
  onChanged?: () => void;
  detail?: boolean;
}

export default function NoteCard(props: NoteCardProps) {
  const loggedIn = () => props.onToggleReaction !== undefined;

  return (
    <article class="note">
      <A
        class="avatarlink"
        href={`/users/${props.note.user.id}`}
        aria-label={`Open profile of ${displayNameOf(props.note.user)}`}
      >
        <Avatar url={props.note.user.avatarUrl} name={displayNameOf(props.note.user)} />
      </A>
      <div class="note-main">
        <div class="note-head">
          <A class="namelink" href={`/users/${props.note.user.id}`}>
            <span class="name">{displayNameOf(props.note.user)}</span>
            <span class="handle">{handleOf(props.note.user)}</span>
          </A>
          <A class="time" href={`/notes/${props.note.id}`}>
            {formatTime(props.note.createdAt)}
          </A>
        </div>

        <NoteBody note={props.note} canVote={loggedIn()} onChanged={props.onChanged} />

        <div class="noteactions">
          <A class="action" href={`/notes/${props.note.id}`} aria-label="Open note">
            <ReplyIcon /> {props.note.repliesCount}
          </A>
          <Show when={props.onRepost} fallback={
            <span class="action" aria-label="Reposts">
              <RepostIcon /> {props.note.renoteCount}
            </span>
          }>
            <Show when={props.reposted} fallback={
              <button
                type="button"
                class="action"
                disabled={props.reposting}
                onClick={() => props.onRepost?.(props.note)}
                aria-label="Repost"
                title="Repost"
              >
                <RepostIcon /> {props.note.renoteCount}
              </button>
            }>
              <button
                type="button"
                class="action active"
                disabled={props.reposting}
                onClick={() => props.onUnrepost?.(props.note)}
                aria-pressed="true"
                aria-label="Undo repost"
                title="Undo repost"
              >
                <RepostIcon /> {props.note.renoteCount}
              </button>
            </Show>
          </Show>
          <Show when={props.onToggleReaction} fallback={
            <span class="action" aria-label="Reactions">
              <HeartIcon filled={props.note.myReaction != null} /> {props.note.reactionCount}
            </span>
          }>
            <ReactionPicker
              counts={props.note.reactions}
              myReaction={props.note.myReaction}
              disabled={props.reacting}
              onPick={(reaction) => props.onToggleReaction?.(props.note, reaction)}
              onUnreact={() => props.onToggleReaction?.(props.note, null)}
            />
            <span class="action" aria-label="Reaction count">{props.note.reactionCount}</span>
          </Show>
        </div>
      </div>
    </article>
  );
}
