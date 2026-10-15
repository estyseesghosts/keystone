import { createSignal, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import type { DriveFile, Note } from "../api/types";
import { displayNameOf, handleOf } from "../api/types";
import MfmRenderer from "./MfmRenderer";
import { HeartIcon, ReplyIcon, RepostIcon } from "./icons";

function formatTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return new Date(t).toLocaleDateString();
}

function Avatar(props: { url: string | null; name: string }) {
  return (
    <Show
      when={props.url}
      fallback={<div class="avatar-fallback" aria-hidden="true">{props.name.slice(0, 1).toUpperCase()}</div>}
    >
      <img class="avatar" src={props.url!} alt="" loading="lazy" />
    </Show>
  );
}

function MediaItem(props: { file: DriveFile }) {
  const [revealed, setRevealed] = createSignal(!props.file.isSensitive);
  const isImage = () => props.file.type.startsWith("image/");
  return (
    <Show
      when={revealed()}
      fallback={
        <button type="button" class="mediafile" onClick={() => setRevealed(true)}>
          Show sensitive media ({props.file.name})
        </button>
      }
    >
      <Show
        when={isImage()}
        fallback={
          <a class="mediafile" href={props.file.url} target="_blank" rel="noopener noreferrer">
            {props.file.name}
          </a>
        }
      >
        <img src={props.file.thumbnailUrl ?? props.file.url} alt={props.file.name} loading="lazy" />
      </Show>
    </Show>
  );
}

export interface NoteCardProps {
  note: Note;
  onToggleReaction?: (note: Note) => void;
  reacting?: boolean;
  onRepost?: (note: Note) => void;
  reposting?: boolean;
  reposted?: boolean;
  detail?: boolean;
}

export default function NoteCard(props: NoteCardProps) {
  const [cwOpen, setCwOpen] = createSignal(false);
  const hasCw = () => (props.note.cw?.length ?? 0) > 0;
  const visible = () => !hasCw() || cwOpen();
  const reacted = () => props.note.myReaction != null;

  return (
    <article class="note">
      <Avatar url={props.note.user.avatarUrl} name={displayNameOf(props.note.user)} />
      <div class="note-main">
        <div class="note-head">
          <span class="name">{displayNameOf(props.note.user)}</span>
          <span class="handle">{handleOf(props.note.user)}</span>
          <A class="time" href={`/notes/${props.note.id}`}>
            {formatTime(props.note.createdAt)}
          </A>
        </div>

        <Show when={hasCw()}>
          <div class="cwbox">
            <p>{props.note.cw}</p>
            <button type="button" onClick={() => setCwOpen((v) => !v)}>
              {cwOpen() ? "Hide" : "Show"}
            </button>
          </div>
        </Show>

        <Show when={visible()}>
          <div class="notebody">
            <MfmRenderer text={props.note.text} />
          </div>
          <Show when={props.note.files.length > 0}>
            <div class="media">
              <For each={props.note.files}>{(file) => <MediaItem file={file} />}</For>
            </div>
          </Show>
          <Show when={props.note.renote}>
            {(renoted) => (
              <A class="renote-embed" href={`/notes/${renoted().id}`}>
                <div class="renote-head">
                  <span class="name">{displayNameOf(renoted().user)}</span>
                  <span class="handle">{handleOf(renoted().user)}</span>
                </div>
                <div class="notebody">
                  <MfmRenderer text={renoted().text} />
                </div>
              </A>
            )}
          </Show>
        </Show>

        <div class="noteactions">
          <A class="action" href={`/notes/${props.note.id}`} aria-label="Open note">
            <ReplyIcon /> {props.note.repliesCount}
          </A>
          <Show when={props.onRepost} fallback={
            <span class="action" aria-label="Reposts">
              <RepostIcon /> {props.note.renoteCount}
            </span>
          }>
            <button
              type="button"
              class={`action${props.reposted ? " active" : ""}`}
              disabled={props.reposting}
              onClick={() => props.onRepost?.(props.note)}
              aria-label="Repost"
              title="Repost"
            >
              <RepostIcon /> {props.note.renoteCount}
            </button>
          </Show>
          <Show when={props.onToggleReaction}>
            <button
              type="button"
              class={`action${reacted() ? " active" : ""}`}
              disabled={props.reacting}
              onClick={() => props.onToggleReaction?.(props.note)}
              aria-label={reacted() ? "Remove reaction" : "React"}
              title={reacted() ? `Reacted ${props.note.myReaction}` : "React"}
            >
              <HeartIcon filled={reacted()} /> {props.note.reactionCount}
            </button>
          </Show>
          <Show when={!props.onToggleReaction}>
            <span class="action" aria-label="Reactions">
              <HeartIcon filled={reacted()} /> {props.note.reactionCount}
            </span>
          </Show>
        </div>
      </div>
    </article>
  );
}
