import { createSignal, For, Show } from "solid-js";
import { apiCall } from "../api/client";
import type { CreatedNoteResponse, Note, NoteVisibility } from "../api/types";

const MAX_LENGTH = 3000;
const VISIBILITIES: NoteVisibility[] = ["public", "home", "followers"];

export default function Composer(props: {
  replyId?: string;
  renoteId?: string;
  onPosted: (note: Note) => void;
}) {
  const [text, setText] = createSignal("");
  const [visibility, setVisibility] = createSignal<NoteVisibility>("public");
  const [posting, setPosting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const remaining = () => MAX_LENGTH - text().length;
  const canPost = () => !posting() && text().trim().length > 0 && text().length <= MAX_LENGTH;

  const post = async () => {
    if (!canPost()) return;
    setPosting(true);
    setError(null);
    try {
      const res = await apiCall<CreatedNoteResponse>("notes/create", {
        text: text().trim(),
        visibility: visibility(),
        ...(props.replyId ? { replyId: props.replyId } : {}),
        ...(props.renoteId ? { renoteId: props.renoteId } : {}),
      });
      setText("");
      setError(null);
      props.onPosted(res.createdNote);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post the note.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div class="composer">
      <textarea
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        placeholder={props.replyId ? "Write a reply…" : props.renoteId ? "Add a comment…" : "What's happening?"}
        maxlength={MAX_LENGTH}
        aria-label={props.replyId ? "Reply text" : props.renoteId ? "Quote comment" : "Note text"}
      />
      <Show when={error()}>
        <div class="err" role="alert">{error()}</div>
      </Show>
      <div class="row">
        <select
          value={visibility()}
          onChange={(e) => setVisibility(e.currentTarget.value as NoteVisibility)}
          aria-label="Visibility"
        >
          <For each={VISIBILITIES}>{(v) => <option value={v}>{v}</option>}</For>
        </select>
        <span class="spacer" />
        <span class="count">{remaining()}</span>
        <button type="button" class="btn-primary" disabled={!canPost()} onClick={post}>
          {posting() ? "Posting…" : props.replyId ? "Reply" : props.renoteId ? "Quote" : "Post"}
        </button>
      </div>
    </div>
  );
}
