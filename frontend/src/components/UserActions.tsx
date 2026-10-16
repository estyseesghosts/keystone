// Per-user moderation actions (§0): block / mute / renote-mute toggles.
// Relation-driven (`users/relation`), writes re-derive from the server.
// The whole block hides when the backend 404s the relation endpoint —
// no inert controls.

import { createSignal, onMount, Show } from "solid-js";
import { apiCall, isUnsupportedError } from "../api/client";
import {
  blockUser,
  fetchRelation,
  muteRenotes,
  muteUser,
  unblockUser,
  unmuteRenotes,
  unmuteUser,
} from "../api/mutes";
import type { UserRelation } from "../api/types";

export default function UserActions(props: { userId: string; isSelf: boolean }) {
  const [relation, setRelation] = createSignal<UserRelation | null>(null);
  const [supported, setSupported] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const load = async () => {
    if (props.isSelf) return;
    try {
      setRelation(await fetchRelation(props.userId));
      setSupported(true);
    } catch (err) {
      if (isUnsupportedError(err)) setSupported(false);
      // Other errors: leave hidden rather than erroring the profile.
      else setSupported(false);
    }
  };

  onMount(() => {
    void load();
  });

  const run = async (fn: () => Promise<unknown>) => {
    if (busy()) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      if (isUnsupportedError(err)) setSupported(false);
      else setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show when={!props.isSelf && supported() && relation()}>
      <div class="row" aria-label="Moderation actions">
        <Show
          when={relation()?.isBlocking}
          fallback={
            <button type="button" disabled={busy()} onClick={() => void run(() => blockUser(props.userId))}>
              Block
            </button>
          }
        >
          <button type="button" disabled={busy()} onClick={() => void run(() => unblockUser(props.userId))}>
            Unblock
          </button>
        </Show>
        <Show
          when={relation()?.isMuted}
          fallback={
            <button type="button" disabled={busy()} onClick={() => void run(() => muteUser(props.userId))}>
              Mute
            </button>
          }
        >
          <button type="button" disabled={busy()} onClick={() => void run(() => unmuteUser(props.userId))}>
            Unmute
          </button>
        </Show>
        <Show
          when={relation()?.isRenoteMuted}
          fallback={
            <button type="button" disabled={busy()} onClick={() => void run(() => muteRenotes(props.userId))}>
              Mute reposts
            </button>
          }
        >
          <button type="button" disabled={busy()} onClick={() => void run(() => unmuteRenotes(props.userId))}>
            Unmute reposts
          </button>
        </Show>
        <Show when={error()}>
          <span class="err" role="alert">{error()}</span>
        </Show>
      </div>
    </Show>
  );
}

/** Probe for the mute/block UI family (relation endpoint). Used by
 * settings to hide the mutes page entry when unsupported. */
export async function moderationSupported(): Promise<boolean> {
  try {
    await apiCall<UserRelation[]>("users/relation", { userId: [] });
    return true;
  } catch (err) {
    if (isUnsupportedError(err)) return false;
    return true;
  }
}
