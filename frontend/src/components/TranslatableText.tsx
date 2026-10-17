// Note text with automatic translation when the server provides it.
//
// Behavior (see docs/quote-polish-translate-handoff.md workstream B, plus
// the token-scope refinement in state/logs/2026-10-16-translate-scope.md):
// - No request fires unless the note carries human prose outside mentions,
//   hashtags, URLs/links, and emoji (`hasTranslatableText`) — structured
//   tokens are never worth translating on their own.
// - The original text renders immediately and stays until a worthwhile
//   translation arrives: no skeleton, no spinner, no layout jump beyond the
//   text swap.
// - A shown translation gets one monochrome line above the text:
//   `Translated from {Language}  Show original` normally, or a generic
//   `Translated  Show original` when the source detection was distrusted
//   (no false source claim). The button toggles back and forth.
// - Translation never fires on servers lacking the endpoint (capability flag
//   from `./translate`), and never fires without visible text to translate.
// - Used for outer note text AND quoted text alike: NoteBody renders both
//   through here, so quoted translations fall out naturally from the same
//   component (one module-level cache keyed by note id dedupes feeds).

import { createEffect, createMemo, createResource, createSignal, onMount, Show } from "solid-js";
import { A } from "@solidjs/router";
import MfmRenderer from "./MfmRenderer";
import { foldMfm } from "../api/fold";
import {
  decideTranslation,
  hasTranslatableText,
  reportTranslationOutcome,
  requestTranslation,
  translationRetryCount,
  translatorAvailable,
  viewerTargetLang,
} from "../api/translate";

export default function TranslatableText(props: {
  noteId: string;
  text: string | null;
  /** False while a content warning hides the text: no request fires until
   * the viewer reveals it (translate the revealed text, not the warning). */
  visible: boolean;
  /** Fold long text to the feed budget (default true). The folded text is
   * whatever is displayed — original or translation, recounted with the
   * same rules when it arrives (a fold-point shift on arrival is
   * accepted). Tag extraction still uses the original elsewhere. */
  foldText?: boolean;
  /** Owning note's packed map, passed to the renderer (translated text
   * falls back to the global listing, then literal). */
  emojis?: Record<string, string> | null;
  /** Note author's host, for host-less codes typed on a remote instance. */
  host?: string | null;
}) {
  const [capable, setCapable] = createSignal(false);
  const [forceOriginal, setForceOriginal] = createSignal(false);

  onMount(() => {
    void translatorAvailable().then((v) => setCapable(v));
  });

  // Null while incapable, hidden, textless, or prose-free: the resource
  // never fires and no attempt is ever made against servers without the
  // endpoint or for posts with nothing to translate.
  // The retry count is part of the source so the post menu's "Translate"
  // refetches after a failure (a new source object triggers the resource).
  const source = createMemo((): { id: string; retry: number } | null =>
    capable() && props.visible && hasTranslatableText(props.text)
      ? { id: props.noteId, retry: translationRetryCount(props.noteId) }
      : null,
  );

  const [fetched] = createResource(source, (s) =>
    requestTranslation(s.id, viewerTargetLang()),
  );

  // The usable translation under the display policy (identical-output and
  // same-script-noise results resolve to null — the original shows with no
  // toggle line and no error).
  const decision = createMemo(() => {
    const result = fetched();
    const original = props.text;
    if (!result || !original) return null;
    const verdict = decideTranslation(original, result);
    return verdict.show ? { text: result.text, label: verdict.label } : null;
  });

  // Report what this note's display shows so the post menu can hide
  // "Translate" once a translation is on screen.
  createEffect(() => {
    if (decision()) {
      reportTranslationOutcome(props.noteId, "loaded");
    } else if (fetched()) {
      reportTranslationOutcome(props.noteId, "unchanged");
    }
  });

  const displayText = createMemo(
    (): string | null =>
      !forceOriginal() && decision() ? decision()!.text : props.text,
  );

  // Fold the displayed text (no inline expand — the reader opens the
  // post). Quoted embeds never reach here folded (NoteBody forces no
  // fold at depth > 0); the detail route passes foldText={false}.
  const folded = createMemo(() => {
    const text = displayText();
    if (props.foldText === false || text == null) return { text, truncated: false };
    return foldMfm(text);
  });

  return (
    <>
      <Show when={decision()}>
        {(d) => (
          <div class="transline">
            <span>{d().label ? `Translated from ${d().label}` : "Translated"}</span>
            <button
              type="button"
              class="trans-toggle"
              onClick={() => setForceOriginal((v) => !v)}
            >
              {forceOriginal() ? "Show translation" : "Show original"}
            </button>
          </div>
        )}
      </Show>
      <div class="trans-text">
        <MfmRenderer text={folded().text} emojis={props.emojis} host={props.host} />
        <Show when={folded().truncated}>
          <span class="foldmore">… <A href={`/notes/${props.noteId}`}>Open post</A></span>
        </Show>
      </div>
    </>
  );
}
