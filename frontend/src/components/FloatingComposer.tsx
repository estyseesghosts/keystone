// Floating post composer: a modal dialog over the current page with the
// full inline Composer (avatar, audience picker, icon toolbar), a close
// button, and Drafts. Closing with unsent prose auto-saves a draft
// (nothing typed is ever lost); restoring a draft first stashes the
// live text the same way. Posting lands on the new note's detail view.
// Drafts (§7) carry the full composer state (attachments, poll,
// recipients, reply/renote context, scheduling); the list has an
// All/Scheduled filter, and server drafts appear alongside the local
// offline cache when the backend serves them (404 → local only).

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { isUnsupportedError } from "../api/client";
import type { Note, ScheduledNote } from "../api/types";
import { useAuth } from "../state/auth";
import { usePostbox } from "../state/postbox";
import {
  deleteDraft,
  isKeepable,
  listDrafts,
  saveDraft,
  type Draft,
  type DraftPayload,
} from "../api/drafts";
import { deleteServerDraft, listServerDrafts } from "../api/serverDrafts";
import type { ServerDraft } from "../api/types";
import Composer from "./Composer";

export default function FloatingComposer() {
  const box = usePostbox();
  const auth = useAuth();
  const navigate = useNavigate();
  const [showDrafts, setShowDrafts] = createSignal(false);
  const [drafts, setDrafts] = createSignal<Draft[]>([]);
  const [serverDrafts, setServerDrafts] = createSignal<ServerDraft[] | null>(null);
  const [scheduledOnly, setScheduledOnly] = createSignal(false);
  // Bump to mount a fresh Composer seeded from a restored draft.
  const [seed, setSeed] = createSignal<{ payload: DraftPayload; n: number } | null>(null);
  const captureRef: { current: (() => DraftPayload) | null } = { current: null };

  const refreshDrafts = () => {
    setDrafts(listDrafts());
    // Server drafts are best-effort: 404 (or signed out) means local-only.
    if (!auth.token()) {
      setServerDrafts(null);
      return;
    }
    void listServerDrafts()
      .then((list) => setServerDrafts(list))
      .catch((err) => {
        if (isUnsupportedError(err)) setServerDrafts(null);
        else setServerDrafts([]);
      });
  };

  // Opening the modal (re)loads the draft list and starts unseeded.
  createEffect(() => {
    if (!box.isOpen()) return;
    setShowDrafts(false);
    setScheduledOnly(false);
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
      if (document.querySelector(".vispick-menu, .compose-emoji-wrap .emojpick")) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  const onPosted = (note: Note) => {
    box.close();
    navigate(`/notes/${note.id}`);
  };

  const onScheduled = (_scheduled: ScheduledNote) => {
    // A scheduled note has no detail view yet: stay open on the
    // confirmation the composer already shows.
  };

  const restore = (draft: Draft) => {
    // The live text is stashed first, so restoring never destroys prose.
    stashLive();
    deleteDraft(draft.id);
    refreshDrafts();
    setShowDrafts(false);
    // Full composer state restores (attachments, poll, recipients,
    // reply/renote context, scheduling, reaction acceptance, noQuote).
    const { id: _id, createdAt: _at, ...payload } = draft;
    void _id;
    void _at;
    setSeed((s) => ({ payload, n: (s?.n ?? 0) + 1 }));
  };

  const remove = (id: string) => {
    deleteDraft(id);
    refreshDrafts();
  };

  const removeServer = async (id: string) => {
    try {
      await deleteServerDraft(id);
    } catch {
      // Keep the row on failure; the message below explains.
    }
    refreshDrafts();
  };

  const visibleDrafts = () =>
    scheduledOnly() ? drafts().filter((d) => (d.scheduledAt ?? "") !== "") : drafts();

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
              <div class="row" role="group" aria-label="Draft filter">
                <button
                  type="button"
                  aria-pressed={!scheduledOnly()}
                  onClick={() => setScheduledOnly(false)}
                >
                  All
                </button>
                <button
                  type="button"
                  aria-pressed={scheduledOnly()}
                  onClick={() => setScheduledOnly(true)}
                >
                  Scheduled
                </button>
              </div>
              <Show
                when={visibleDrafts().length > 0 || (serverDrafts() ?? []).length > 0}
                fallback={
                  <div class="state">
                    <p>No drafts yet. Dismissing the composer with unsent text saves one here.</p>
                  </div>
                }
              >
                <For each={visibleDrafts()}>
                  {(draft) => (
                    <div class="draftrow">
                      <button
                        type="button"
                        class="drafttext"
                        onClick={() => restore(draft)}
                        aria-label={`Restore draft: ${draft.text.slice(0, 60) || "(no text)"}`}
                        title="Restore this draft"
                      >
                        {draft.text.slice(0, 120) || <span class="handle">(no text)</span>}
                        {draft.scheduledAt ? <span class="handle"> · scheduled</span> : null}
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
                <Show when={serverDrafts() !== null && (serverDrafts() ?? []).length > 0}>
                  <p class="handle">Server drafts</p>
                  <For each={serverDrafts()!}>
                    {(draft) => (
                      <div class="draftrow">
                        <span class="drafttext">
                          {(draft.text ?? "").slice(0, 120) || <span class="handle">(no text)</span>}
                          {draft.scheduledAt ? <span class="handle"> · scheduled</span> : null}
                        </span>
                        <button
                          type="button"
                          onClick={() => void removeServer(draft.id)}
                          aria-label="Delete this server draft"
                          title="Delete this server draft"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </For>
                </Show>
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
                onScheduled={onScheduled}
              />
            );
          })()}
        </div>
      </div>
    </Show>
  );
}
