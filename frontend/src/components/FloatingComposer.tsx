// Floating post composer: a modal dialog over the current page with the
// full inline Composer (avatar, audience picker, icon toolbar), a close
// button, and Drafts. Closing with unsent prose auto-saves a draft
// (nothing typed is ever lost); restoring a draft first stashes the
// live text the same way. Posting lands on the new note's detail view.

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { Note } from "../api/types";
import { usePostbox } from "../state/postbox";
import {
  deleteDraft,
  isKeepable,
  listDrafts,
  saveDraft,
  type Draft,
  type DraftPayload,
} from "../api/drafts";
import Composer from "./Composer";

export default function FloatingComposer() {
  const box = usePostbox();
  const navigate = useNavigate();
  const [showDrafts, setShowDrafts] = createSignal(false);
  const [drafts, setDrafts] = createSignal<Draft[]>([]);
  // Bump to mount a fresh Composer seeded from a restored draft.
  const [seed, setSeed] = createSignal<{ payload: DraftPayload; n: number } | null>(null);
  const captureRef: { current: (() => DraftPayload) | null } = { current: null };

  const refreshDrafts = () => setDrafts(listDrafts());

  // Opening the modal (re)loads the draft list and starts unseeded.
  createEffect(() => {
    if (!box.isOpen()) return;
    setShowDrafts(false);
    setSeed(null);
    refreshDrafts();
  });

  const livePayload = (): DraftPayload | null => {
    const read = captureRef.current;
    if (!read) return null;
    try {
      return read();
    } catch {
      return null;
    }
  };

  const stashLive = () => {
    const payload = livePayload();
    if (payload && isKeepable(payload)) saveDraft(payload);
  };

  const close = () => {
    // Dismissing with unsent prose keeps it as a draft.
    stashLive();
    box.close();
  };

  // Escape dismisses (yields while one of the composer's own popups is
  // open — those close themselves first).
  createEffect(() => {
    if (!box.isOpen()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".vispick-menu, .compose-emoji-wrap .reactpicker")) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  const onPosted = (note: Note) => {
    box.close();
    navigate(`/notes/${note.id}`);
  };

  const restore = (draft: Draft) => {
    // The live text is stashed first, so restoring never destroys prose.
    stashLive();
    deleteDraft(draft.id);
    refreshDrafts();
    setShowDrafts(false);
    setSeed((s) => ({
      payload: {
        text: draft.text,
        cw: draft.cw,
        visibility: draft.visibility,
        localOnly: draft.localOnly,
      },
      n: (s?.n ?? 0) + 1,
    }));
  };

  const remove = (id: string) => {
    deleteDraft(id);
    refreshDrafts();
  };

  return (
    <Show when={box.isOpen()}>
      <div
        class="postbox-overlay"
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div class="postbox" role="dialog" aria-modal="true" aria-label="Write a post">
          <div class="postbox-head">
            <button type="button" class="postbox-close" onClick={close} aria-label="Close composer">
              ×
            </button>
            <span class="spacer" aria-hidden="true" />
            <button
              type="button"
              class="postbox-drafts"
              onClick={() => {
                refreshDrafts();
                setShowDrafts((v) => !v);
              }}
              aria-expanded={showDrafts()}
              aria-label={drafts().length > 0 ? `Drafts (${drafts().length})` : "Drafts"}
              title="Drafts"
            >
              Drafts{drafts().length > 0 ? ` (${drafts().length})` : ""}
            </button>
          </div>
          <Show when={showDrafts()}>
            <div class="postbox-draftlist" aria-label="Saved drafts">
              <Show
                when={drafts().length > 0}
                fallback={
                  <div class="state">
                    <p>No drafts yet. Dismissing the composer with unsent text saves one here.</p>
                  </div>
                }
              >
                <For each={drafts()}>
                  {(draft) => (
                    <div class="draftrow">
                      <button
                        type="button"
                        class="drafttext"
                        onClick={() => restore(draft)}
                        aria-label={`Restore draft: ${draft.text.slice(0, 60) || "(content warning only)"}`}
                        title="Restore this draft"
                      >
                        {draft.text.slice(0, 120) || <span class="handle">(content warning only)</span>}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(draft.id)}
                        aria-label="Delete this draft"
                        title="Delete this draft"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </Show>
          {(() => {
            // Non-null seed remounts the Composer with the draft; the
            // IIFE re-evaluates only when the seed generation changes.
            const s = seed();
            void s?.n;
            return (
              <Composer
                captureRef={captureRef}
                initial={s?.payload}
                onPosted={onPosted}
              />
            );
          })()}
        </div>
      </div>
    </Show>
  );
}
