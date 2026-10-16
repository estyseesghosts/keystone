// Bounded profile editor (`i/update` common subset). Shared by the own-
// profile view and Settings — the subset is the verified contract (see
// docs/api-surface.md), so this component never sends anything else.

import { createSignal, Show } from "solid-js";
import { apiCall, isPermissionError } from "../api/client";
import type { MeDetailed } from "../api/types";

export default function ProfileEditor(props: {
  me: MeDetailed;
  onSaved: (me: MeDetailed) => void;
}) {
  const [name, setName] = createSignal(props.me.name ?? "");
  const [description, setDescription] = createSignal(props.me.description ?? "");
  const [location, setLocation] = createSignal(props.me.location ?? "");
  const [birthday, setBirthday] = createSignal(props.me.birthday ?? "");
  const [isLocked, setIsLocked] = createSignal(props.me.isLocked);
  const [isBot, setIsBot] = createSignal((props.me as { isBot?: boolean }).isBot ?? false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const save = async () => {
    if (saving()) return;
    setSaving(true);
    setError(null);
    try {
      // Bounded common subset verified on Misskey-family and Pinetree
      // (name/description/location/birthday + flags). Anything else is a
      // separate slice — never send fields the contract does not cover.
      const updated = await apiCall<MeDetailed>("i/update", {
        name: name().trim(),
        description: description().trim(),
        location: location().trim(),
        birthday: birthday().trim() === "" ? null : birthday().trim(),
        isLocked: isLocked(),
        isBot: isBot(),
      });
      props.onSaved(updated);
    } catch (err) {
      setError(
        isPermissionError(err)
          ? "Your session lacks the profile-edit permission. Sign out and sign in again, then retry."
          : err instanceof Error ? err.message : "Could not save the profile.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="form">
      <div class="field">
        <label for="profile-name">Display name</label>
        <input id="profile-name" type="text" value={name()} onInput={(e) => setName(e.currentTarget.value)} maxlength={50} />
      </div>
      <div class="field">
        <label for="profile-description">Bio</label>
        <textarea value={description()} onInput={(e) => setDescription(e.currentTarget.value)} maxlength={1500} aria-label="Bio" />
      </div>
      <div class="field">
        <label for="profile-location">Location</label>
        <input id="profile-location" type="text" value={location()} onInput={(e) => setLocation(e.currentTarget.value)} maxlength={50} />
      </div>
      <div class="field">
        <label for="profile-birthday">Birthday (YYYY-MM-DD, blank to clear)</label>
        <input id="profile-birthday" type="text" value={birthday()} onInput={(e) => setBirthday(e.currentTarget.value)} placeholder="YYYY-MM-DD" />
      </div>
      <div class="field">
        <label><input type="checkbox" checked={isLocked()} onChange={(e) => setIsLocked(e.currentTarget.checked)} /> Locked account (approve followers)</label>
      </div>
      <div class="field">
        <label><input type="checkbox" checked={isBot()} onChange={(e) => setIsBot(e.currentTarget.checked)} /> This is a bot account</label>
      </div>
      <Show when={error()}>
        <div class="err" role="alert">{error()}</div>
      </Show>
      <button type="button" class="btn-primary" disabled={saving()} onClick={save}>
        {saving() ? "Saving…" : "Save profile"}
      </button>
    </div>
  );
}
