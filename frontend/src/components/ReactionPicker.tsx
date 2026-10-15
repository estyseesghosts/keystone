import { createSignal, For, Show } from "solid-js";

/** Common Unicode reactions. The server normalizes ❤️ (U+2764 U+FE0F) to ❤
 * (U+2764), so the normalized form is listed first — optimistic client
 * state then matches the reconciled server state exactly. Servers coerce
 * other unknown reactions per their own rules. Custom emoji codes can be
 * typed exactly (e.g. :blobcat:) when the instance hosts them. */
export const COMMON_REACTIONS = ["❤", "👍", "😆", "🤔", "😮", "🎉", "💢", "😥", "😇", "🍮"];

export default function ReactionPicker(props: {
  counts: Record<string, number>;
  myReaction: string | null;
  disabled?: boolean;
  onPick: (reaction: string) => void;
  onUnreact: () => void;
}) {
  const [custom, setCustom] = createSignal("");
  const [open, setOpen] = createSignal(false);

  const submitCustom = () => {
    const value = custom().trim();
    if (value.length === 0) return;
    setCustom("");
    setOpen(false);
    props.onPick(value);
  };

  return (
    <Show when={props.myReaction} fallback={
      <Show when={open()} fallback={
        <button
          type="button"
          class="action"
          disabled={props.disabled}
          onClick={() => setOpen(true)}
          aria-label="Choose a reaction"
          title="React"
        >
          ♡
        </button>
      }>
        <div class="reactpicker" role="dialog" aria-label="Choose a reaction">
          <For each={COMMON_REACTIONS}>
            {(r) => (
              <button
                type="button"
                disabled={props.disabled}
                onClick={() => { setOpen(false); props.onPick(r); }}
                aria-label={`React ${r}`}
                title={`${r}${props.counts[r] ? ` (${props.counts[r]})` : ""}`}
              >
                {r}{props.counts[r] ? ` ${props.counts[r]}` : ""}
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
            <button type="submit" disabled={props.disabled || custom().trim().length === 0}>
              Send
            </button>
          </form>
          <button type="button" onClick={() => setOpen(false)}>Close</button>
        </div>
      </Show>
    }>
      <button
        type="button"
        class="action active"
        disabled={props.disabled}
        onClick={props.onUnreact}
        aria-label={`Remove reaction ${props.myReaction}`}
        title={`Reacted ${props.myReaction} — remove`}
      >
        ♥ {props.myReaction}
      </button>
    </Show>
  );
}
