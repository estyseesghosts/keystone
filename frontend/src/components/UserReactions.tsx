// Reactions viewer (§3): a `users/reactions`-backed dialog listing a
// user's reactions with the Misskey states — REACTIONS_NOT_PUBLIC notice,
// remote-user notice, blocked-viewer empty state. 404 hides the entry
// point (the caller probes first); this dialog renders the states.

import { createSignal, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { apiCall, ApiError, isUnsupportedError } from "../api/client";
import type { Note, UserLite } from "../api/types";
import { DisplayName } from "./EmojiPicker";
import { EmojiGlyph } from "./EmojiPicker";

export interface UserReaction {
  id: string;
  createdAt: string;
  user?: UserLite | null;
  type: string;
  note?: Note | null;
}

async function fetchUserReactions(userId: string): Promise<UserReaction[]> {
  return apiCall<UserReaction[]>("users/reactions", { userId, limit: 20 });
}

export async function userReactionsSupported(userId: string): Promise<boolean> {
  try {
    await apiCall<UserReaction[]>("users/reactions", { userId, limit: 1 });
    return true;
  } catch (err) {
    if (isUnsupportedError(err)) return false;
    // Auth/policy errors still mean the endpoint exists.
    return true;
  }
}

export default function UserReactions(props: { userId: string; isRemote: boolean }) {
  const [open, setOpen] = createSignal(false);
  const [items, setItems] = createSignal<UserReaction[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [notPublic, setNotPublic] = createSignal(false);
  const [blocked, setBlocked] = createSignal(false);
  const [supported, setSupported] = createSignal(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    setNotPublic(false);
    setBlocked(false);
    try {
      setItems(await fetchUserReactions(props.userId));
      setSupported(true);
    } catch (err) {
      if (isUnsupportedError(err)) {
        setSupported(false);
      } else if (
        err instanceof ApiError &&
        (err.code === "REACTIONS_NOT_PUBLIC" || err.message.includes("REACTIONS_NOT_PUBLIC"))
      ) {
        setNotPublic(true);
      } else if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
        setBlocked(true);
      } else {
        setError(err instanceof Error ? err.message : "Could not load reactions.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Show when={supported()}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open()) void load();
        }}
        aria-expanded={open()}
      >
        Reactions
      </button>
      <Show when={open()}>
        <div class="settings-block" role="dialog" aria-label="User reactions">
          <Show when={props.isRemote}>
            <p class="handle">Reactions from remote users may be incomplete.</p>
          </Show>
          <Show when={loading()} fallback={
            <Show when={notPublic()} fallback={
              <Show when={blocked()} fallback={
                <Show when={error()} fallback={
                  <Show when={items().length > 0} fallback={
                    <p class="handle">No reactions.</p>
                  }>
                    <For each={items()}>
                      {(r) => (
                        <div class="notif">
                          <div class="notif-main">
                            <div class="notif-desc">
                              <EmojiGlyph emoji={r.type} />
                              {" "}on{" "}
                              <Show when={r.note} fallback={
                                <span class="handle">a note you cannot see</span>
                              }>
                                <A class="action" href={`/notes/${r.note!.id}`}>a note</A>
                                <Show when={r.note!.user}>
                                  <span class="handle">
                                    {" "}by <DisplayName name={r.note!.user.name ?? r.note!.user.username} packed={r.note!.user.emojis} />
                                  </span>
                                </Show>
                              </Show>
                            </div>
                          </div>
                        </div>
                      )}
                    </For>
                  </Show>
                }>
                  <div class="err" role="alert">{error()}</div>
                </Show>
              }>
                <p class="handle">You cannot view these reactions.</p>
              </Show>
            }>
              <p class="handle">This user's reactions are not public.</p>
            </Show>
          }>
            <p class="handle" role="status">Loading reactions…</p>
          </Show>
        </div>
      </Show>
    </Show>
  );
}
