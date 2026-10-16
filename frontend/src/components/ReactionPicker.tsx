import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { Note } from "../api/types";
import { effectiveMyReaction } from "../api/myReactions";
import {
  isHeartReaction,
  isLikeActive,
  visibleReactions,
} from "../api/emoji";
import { useEmojiPrefs } from "../state/emojiPrefs";
import { HeartIcon } from "./icons";
import { EmojiGlyph } from "./EmojiPicker";

/** One chip. Counts and ownership arrive as accessors so a reconciled
 * note object updates the text in place — the chip is keyed by its
 * reaction string upstream and never remounts on refresh. Custom
 * `:code:` reactions render their hosted image when the packed URL is
 * known, else the literal code. */
function Chip(props: {
  reactionKey: string;
  count: () => number;
  mine: () => boolean;
  packed?: Record<string, string> | null;
  host?: string | null;
  onToggle?: (reaction: string | null) => void;
}) {
  const label = () =>
    props.mine() ? `Remove ${props.reactionKey} reaction` : `React ${props.reactionKey}`;
  return (
    <Show when={props.onToggle} fallback={
      <span class="rxn">
        <EmojiGlyph emoji={props.reactionKey} packed={props.packed} host={props.host} /> {props.count()}
      </span>
    }>
      <button
        type="button"
        class={props.mine() ? "rxn mine" : "rxn"}
        aria-pressed={props.mine()}
        aria-label={label()}
        title={label()}
        onClick={() => props.onToggle!(props.mine() ? null : props.reactionKey)}
      >
        <EmojiGlyph emoji={props.reactionKey} packed={props.packed} host={props.host} /> {props.count()}
      </button>
    </Show>
  );
}

/** Misskey-style reaction chips above the action bar: emoji + numeric
 * count each, rendered only when at least one non-like reaction exists
 * (no deadspace otherwise). Hearts and the configured custom like
 * emoji are excluded — both live on the like button only. Clicking a
 * chip toggles it; without a toggle handler the chips are static. */
export function ReactionChips(props: {
  note: Note;
  onToggle?: (reaction: string | null) => void;
}) {
  const prefs = useEmojiPrefs();
  // Key strings are primitives: equal strings are identical across
  // recomputes, so refreshes move (or leave) chips instead of remounting
  // them. Counts/ownership flow through accessors into each Chip.
  const keys = createMemo(() =>
    visibleReactions(props.note.reactions, prefs.likeEmoji()).map(([key]) => key),
  );
  const counts = () => props.note.reactions ?? {};
  // Ownership reads the confirmed-reaction overlay: the row always
  // reflects the last successful write, even when the reconciled server
  // object doesn't pack it yet. No remounts, no flashes.
  const mineKey = () => effectiveMyReaction(props.note);
  // Per-note packed URLs (`reactionEmojis`, bare-name → URL) resolve
  // remote custom emoji too — the global listing is the fallback.
  const packed = () => props.note.reactionEmojis ?? null;
  return (
    <Show when={keys().length > 0}>
      <div class="reactions" aria-label="Reactions">
        <For each={keys()}>
          {(key) => (
            <Chip
              reactionKey={key}
              count={() => counts()[key] ?? 0}
              mine={() => mineKey() === key}
              packed={packed()}
              host={props.note.user.host}
              onToggle={props.onToggle}
            />
          )}
        </For>
      </div>
    </Show>
  );
}

/** The like button. Unliked: the outline heart. Liked: the viewer's
 * actual reaction — a filled heart for heart likes, the custom emoji
 * glyph when a custom like is in effect. Clicking likes with the
 * configured like emoji (device-local setting, heart by default) or
 * unlikes; the heart-to-emoji swap plays a short pop (disabled under
 * `prefers-reduced-motion`). The count is the server's
 * `reactionCount`, which includes every reaction kind. */
export function LikeButton(props: {
  note: Note;
  onReact: (reaction: string | null) => void;
}) {
  const prefs = useEmojiPrefs();
  const like = () => prefs.likeEmoji();
  const liked = () => isLikeActive(like(), effectiveMyReaction(props.note));
  const [popping, setPopping] = createSignal(false);
  let frame: number | undefined;
  let timer: number | undefined;
  onCleanup(() => {
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  });

  const click = () => {
    const active = liked();
    if (!active) {
      // Restart the swap animation: drop the class, re-add next frame.
      setPopping(false);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      frame = window.requestAnimationFrame(() => setPopping(true));
      timer = window.setTimeout(() => setPopping(false), 260);
    }
    props.onReact(active ? null : like());
  };

  const label = () =>
    liked()
      ? "Unlike"
      : isHeartReaction(like())
        ? "Like"
        : `Like with ${like()}`;

  return (
    <button
      type="button"
      class={liked() ? "action active" : "action"}
      aria-pressed={liked()}
      aria-label={label()}
      title={liked() ? "Liked — remove" : label()}
      onClick={click}
    >
      <span class={popping() ? "likepop" : undefined} aria-hidden="true">
        <Show when={liked()} fallback={<HeartIcon filled={false} />}>
          <Show
            when={!isHeartReaction(effectiveMyReaction(props.note))}
            fallback={<HeartIcon filled />}
          >
            <EmojiGlyph
              emoji={effectiveMyReaction(props.note) ?? like()}
              packed={props.note.reactionEmojis}
              host={props.note.user.host}
            />
          </Show>
        </Show>
      </span>{" "}
      {props.note.reactionCount}
    </button>
  );
}
