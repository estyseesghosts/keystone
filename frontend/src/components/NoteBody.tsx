import { createSignal, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import type { DriveFile, Note } from "../api/types";
import { displayNameOf, handleOf } from "../api/types";
import { apiCall } from "../api/client";
import MfmRenderer from "./MfmRenderer";

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

function FileLink(props: { file: DriveFile }) {
  return (
    <a class="mediafile" href={props.file.url} target="_blank" rel="noopener noreferrer">
      {props.file.name}
    </a>
  );
}

function MediaItem(props: { file: DriveFile }) {
  const [revealed, setRevealed] = createSignal(!props.file.isSensitive);
  const [failed, setFailed] = createSignal(false);
  const isImage = () => props.file.type.startsWith("image/");
  const isVideo = () => props.file.type.startsWith("video/");
  const isAudio = () => props.file.type.startsWith("audio/");
  return (
    <Show
      when={revealed()}
      fallback={
        <button type="button" class="mediafile" onClick={() => setRevealed(true)}>
          Show sensitive media ({props.file.name})
        </button>
      }
    >
      <Show when={failed()} fallback={
        <Show
          when={isImage()}
          fallback={
            <Show
              when={isVideo()}
              fallback={
                <Show when={isAudio()} fallback={<FileLink file={props.file} />}>
                  <audio
                    controls
                    preload="metadata"
                    src={props.file.url}
                    onError={() => setFailed(true)}
                  >
                    Your browser cannot play this audio ({props.file.name})
                  </audio>
                </Show>
              }
            >
              <video
                controls
                preload="metadata"
                src={props.file.url}
                onError={() => setFailed(true)}
              >
                Your browser cannot play this video ({props.file.name})
              </video>
            </Show>
          }
        >
          <img
            src={props.file.thumbnailUrl ?? props.file.url}
            alt={props.file.name}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        </Show>
      }>
        <FileLink file={props.file} />
      </Show>
    </Show>
  );
}

function PollBlock(props: { note: Note; canVote: boolean; onChanged?: () => void }) {
  const [voting, setVoting] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const poll = () => props.note.poll!;
  const total = () => poll().choices.reduce((sum, c) => sum + c.votes, 0);
  const voted = () => poll().choices.some((c) => c.isVoted);

  const vote = async (choice: number) => {
    if (!props.canVote || voting() !== null || voted()) return;
    setVoting(choice);
    setError(null);
    try {
      await apiCall<undefined>("notes/polls/vote", {
        noteId: props.note.id,
        choice,
      });
      props.onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vote failed.");
    } finally {
      setVoting(null);
    }
  };

  return (
    <div class="poll">
      <For each={poll().choices}>
        {(choice, i) => (
          <button
            type="button"
            class="pollopt"
            disabled={!props.canVote || voting() !== null || voted()}
            onClick={() => void vote(i())}
            aria-label={voted() || !props.canVote ? `${choice.text}: ${choice.votes} votes` : `Vote for ${choice.text}`}
          >
            <span>{choice.isVoted ? "✓ " : ""}{choice.text}</span>
            <span class="handle">{choice.votes}</span>
          </button>
        )}
      </For>
      <div class="handle">
        {total()} votes{props.note.poll!.multiple ? " · multiple choice" : ""}
        {props.note.poll!.expiresAt ? ` · ends ${new Date(props.note.poll!.expiresAt).toLocaleString()}` : ""}
      </div>
      <Show when={error()}>
        <div class="err" role="alert">{error()}</div>
      </Show>
    </div>
  );
}

export interface NoteBodyProps {
  note: Note;
  canVote: boolean;
  onChanged?: () => void;
  /** Embed depth: top-level notes render at 0, quoted renotes at 1.
   * Deeper nesting collapses to a link so embeds can never recurse. */
  depth?: number;
}

/** The single rendering path for note content: CW gate, text, media, poll,
 * and quoted renotes. Both top-level cards and embedded quotes go through
 * here, so an embedded note's content warning and sensitive-media controls
 * always apply — hiding the outer note is never the only protection. */
export default function NoteBody(props: NoteBodyProps) {
  const [cwOpen, setCwOpen] = createSignal(false);
  const depth = () => props.depth ?? 0;
  const hasCw = () => (props.note.cw?.length ?? 0) > 0;
  const visible = () => !hasCw() || cwOpen();

  return (
    <>
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
        <Show when={props.note.poll}>
          <PollBlock note={props.note} canVote={props.canVote} onChanged={props.onChanged} />
        </Show>
        <Show when={props.note.renote}>
          {(renoted) => (
            <Show when={depth() === 0} fallback={
              <div class="renote-foot">
                <A href={`/notes/${renoted().id}`}>Open quoted note</A>
              </div>
            }>
              <div class="renote-embed">
                <div class="renote-head">
                  <span class="name">{displayNameOf(renoted().user)}</span>
                  <span class="handle">{handleOf(renoted().user)}</span>
                </div>
                <NoteBody
                  note={renoted()}
                  canVote={props.canVote}
                  onChanged={props.onChanged}
                  depth={depth() + 1}
                />
                <div class="renote-foot">
                  <A href={`/notes/${renoted().id}`}>Open quoted note</A>
                </div>
              </div>
            </Show>
          )}
        </Show>
      </Show>
    </>
  );
}

export { Avatar };
