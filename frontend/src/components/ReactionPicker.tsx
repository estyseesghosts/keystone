import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { Note } from "../api/types";
import { HeartIcon, SmileIcon } from "./icons";

/** The like reaction. The server normalizes ❤️ (U+2764 U+FE0F) to ❤
 * (U+2764), so the normalized form is canonical — optimistic client
 * state then matches the reconciled server state exactly. */
export const HEART_REACTION = "❤";

export function isHeartReaction(reaction: string | null): boolean {
  return reaction === "❤" || reaction === "❤️";
}

/** Chips-row entries: every reaction with a positive count except hearts
 * (hearts live on the like button only), sorted by count descending.
 * Tolerates a null/undefined map (servers can transiently pack one). */
export function visibleReactions(
  reactions: Record<string, number> | null | undefined,
): [string, number][] {
  return Object.entries(reactions ?? {})
    .filter(([key, count]) => count > 0 && !isHeartReaction(key))
    .sort((a, b) => b[1] - a[1]);
}

/** One chip. Counts and ownership arrive as accessors so a reconciled
 * note object updates the text in place — the chip is keyed by its
 * reaction string upstream and never remounts on refresh. */
function Chip(props: {
  reactionKey: string;
  count: () => number;
  mine: () => boolean;
  onToggle?: (reaction: string | null) => void;
}) {
  const label = () =>
    props.mine() ? `Remove ${props.reactionKey} reaction` : `React ${props.reactionKey}`;
  return (
    <Show when={props.onToggle} fallback={
      <span class="rxn">
        {props.reactionKey} {props.count()}
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
        {props.reactionKey} {props.count()}
      </button>
    </Show>
  );
}

/** Misskey-style reaction chips above the action bar: emoji + numeric
 * count each, rendered only when at least one non-heart reaction exists
 * (no deadspace otherwise). Clicking a chip toggles it; without a toggle
 * handler the chips are static. */
export function ReactionChips(props: {
  note: Note;
  onToggle?: (reaction: string | null) => void;
}) {
  // Key strings are primitives: equal strings are identical across
  // recomputes, so refreshes move (or leave) chips instead of remounting
  // them. Counts/ownership flow through accessors into each Chip.
  const keys = createMemo(() =>
    visibleReactions(props.note.reactions).map(([key]) => key),
  );
  const counts = () => props.note.reactions ?? {};
  return (
    <Show when={keys().length > 0}>
      <div class="reactions" aria-label="Reactions">
        <For each={keys()}>
          {(key) => (
            <Chip
              reactionKey={key}
              count={() => counts()[key] ?? 0}
              mine={() => props.note.myReaction === key}
              onToggle={props.onToggle}
            />
          )}
        </For>
      </div>
    </Show>
  );
}

/** The like button: filled heart + total count when the viewer liked,
 * outline + total count otherwise. The count is the server's
 * `reactionCount`, which includes every reaction kind (hearts included).
 * A like is a like — this button only ever adds or removes ❤. */
export function LikeButton(props: {
  note: Note;
  onToggle: () => void;
}) {
  const liked = () => isHeartReaction(props.note.myReaction);
  return (
    <button
      type="button"
      class={liked() ? "action active" : "action"}
      aria-pressed={liked()}
      aria-label={liked() ? "Unlike" : "Like"}
      title={liked() ? "Liked — remove" : "Like"}
      onClick={props.onToggle}
    >
      <HeartIcon filled={liked()} /> {props.note.reactionCount}
    </button>
  );
}

/** Emoji reactions other than ❤. Preset + custom-emoji codes can be typed
 * exactly (e.g. :blobcat:) when the instance hosts them; servers coerce
 * unknown reactions per their own rules. */
export const COMMON_REACTIONS = ["👍", "😆", "🤔", "😮", "🎉", "💢", "😥", "😇", "🍮"];

/** Separate emoji-reaction button next to the like button. Always the same
 * smiley glyph in the same style — it carries no reacted state because a
 * set reaction already shows highlighted in the chips row. Opens the
 * picker for any other emoji reaction. */
export function EmojiButton(props: {
  myReaction: string | null;
  onPick: (reaction: string) => void;
  onUnreact: () => void;
}) {
  const [custom, setCustom] = createSignal("");
  const [open, setOpen] = createSignal(false);

  // The popup closes on outside click or Escape.
  createEffect(() => {
    if (!open()) return;
    const onDocClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.(".emojwrap")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    });
  });

  const submitCustom = () => {
    const value = custom().trim();
    if (value.length === 0) return;
    setCustom("");
    setOpen(false);
    props.onPick(value);
  };

  return (
    <span class="emojwrap">
      <button
        type="button"
        class="action"
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-label="Emoji reaction"
        title="Emoji reaction"
        onClick={() => setOpen((v) => !v)}
      >
        <SmileIcon />
      </button>
      <Show when={open()}>
        <div class="reactpicker popup" role="dialog" aria-label="Choose a reaction">
          <For each={COMMON_REACTIONS}>
            {(r) => (
              <button
                type="button"
                onClick={() => { setOpen(false); props.onPick(r); }}
                aria-label={`React ${r}`}
                title={`React ${r}`}
              >
                {r}
              </button>
            )}
          </For>
          <form
            class="reactcustom"
            onSubmit={(e) => { e.preventDefault(); submitCustom(); }}
          >
            <input
              type="text"
              value={custom()}
              onInput={(e) => setCustom(e.currentTarget.value)}
              placeholder=":custom_emoji:"
              aria-label="Custom reaction"
            />
            <button type="submit" disabled={custom().trim().length === 0}>
              Send
            </button>
          </form>
          <Show when={props.myReaction}>
            <button
              type="button"
              onClick={() => { setOpen(false); props.onUnreact(); }}
            >
              Remove reaction
            </button>
          </Show>
          <button type="button" onClick={() => setOpen(false)}>Close</button>
        </div>
      </Show>
    </span>
  );
}
