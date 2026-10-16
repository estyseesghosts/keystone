// Tag-block bubble: `(#first +N)` in the note header, opening a floating
// panel with the pruned block tags. Monochrome, reusing the chip language
// (rounded-full, grey surfaces, hairline borders).
//
// `tags` is the bubble set: pruned block tags only (`blockedTags` from
// `parseTagBlocks`) — lone hashtags stay inline in the post and never
// enter the bubble. One popup open at a time per bubble instance; the
// dismiss pattern (outside click + Escape) copies the renote menu in
// `NoteCard`. Two bubbles on one card (outer head + quote head) are
// independent instances, so both popups can briefly be open at once —
// accepted, noted in the log.

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { A } from "@solidjs/router";

export default function TagBubble(props: { tags: string[] }) {
  const [open, setOpen] = createSignal(false);

  createEffect(() => {
    if (!open()) return;
    const onDocClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.(".tagwrap")) setOpen(false);
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

  const first = () => props.tags[0] ?? "";
  const rest = () => Math.max(0, props.tags.length - 1);

  return (
    <span class="tagwrap">
      <button
        type="button"
        class="tagbubble"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-label={`Show ${props.tags.length} tags`}
        title={`Show ${props.tags.length} tags`}
      >
        <Show when={rest() > 0} fallback={<span class="tagfirst">#{first()}</span>}>
          <span class="tagfirst">
            (#{first()} +{rest()})
          </span>
        </Show>
      </button>
      <Show when={open()}>
        <div class="tagpop" role="menu" aria-label="Tags in this post">
          <For each={props.tags}>
            {(tag) => (
              <A role="menuitem" href={`/search?tag=${encodeURIComponent(tag)}`}>
                #{tag}
              </A>
            )}
          </For>
        </div>
      </Show>
    </span>
  );
}
