// Note text with automatic translation when the server provides it.
//
// Behavior (see docs/quote-polish-translate-handoff.md workstream B):
// - The original text renders immediately and stays until a translation
//   arrives: no skeleton, no spinner, no layout jump beyond the text swap.
// - When a cached/fetched translation arrives whose sourceLang differs from
//   the viewer's language, the translated text shows with one monochrome
//   line above it: `Translated from {Language}  Show original`. The button
//   toggles back and forth; failures and same-language results show the
//   original with no toggle line and no error.
// - Translation never fires on servers lacking the endpoint (capability flag
//   from `./translate`), and never fires without visible text to translate.
// - Used for outer note text AND quoted text alike: NoteBody renders both
//   through here, so quoted translations fall out naturally from the same
//   component (one module-level cache keyed by note id dedupes feeds).

import { createMemo, createResource, createSignal, onMount, Show } from "solid-js";
import MfmRenderer from "./MfmRenderer";
import {
  requestTranslation,
  translationDiffers,
  translatorAvailable,
  viewerTargetLang,
} from "../api/translate";

export default function TranslatableText(props: {
  noteId: string;
  text: string | null;
  /** False while a content warning hides the text: no request fires until
   * the viewer reveals it (translate the revealed text, not the warning). */
  visible: boolean;
}) {
  const [capable, setCapable] = createSignal(false);
  const [forceOriginal, setForceOriginal] = createSignal(false);

  onMount(() => {
    void translatorAvailable().then((v) => setCapable(v));
  });

  // Null while incapable, hidden, or textless: the resource never fires and
  // no attempt is ever made against servers without the endpoint.
  const source = createMemo((): string | null =>
    capable() && props.visible && props.text ? props.noteId : null,
  );

  const [fetched] = createResource(source, (id) =>
    requestTranslation(id, viewerTargetLang()),
  );

  // The usable translation: present, and in a different language than the
  // viewer's. Same-language results stay on the original with no toggle.
  const translation = createMemo(() => {
    const result = fetched();
    if (!result || !translationDiffers(result.sourceLang)) return null;
    return result;
  });

  const displayText = createMemo(
    (): string | null =>
      !forceOriginal() && translation() ? translation()!.text : props.text,
  );

  return (
    <>
      <Show when={translation()}>
        {(t) => (
          <div class="transline">
            <span>Translated from {t().sourceLang}</span>
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
        <MfmRenderer text={displayText()} />
      </div>
    </>
  );
}
