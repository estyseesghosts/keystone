// Full profile editor (§1): the complete `i/update` set, grown in place
// in this same component. Sends every field the form covers; the server
// owns trims/empties semantics, the client validates lengths only and shows
// server errors verbatim. Avatar/banner wire through DriveBrowser select
// mode (upload → select → `i/update`). Fields the backend rejects stay in
// the form — the error names them and nothing is silently dropped.

import { createSignal, For, Show } from "solid-js";
import { apiCall, isPermissionError } from "../api/client";
import type { DriveFile, MeDetailed, ProfileUpdateParams } from "../api/types";
import {
  formatWordGroups,
  parseMutedInstances,
  parseWordGroups,
} from "../api/softMute";
import DriveBrowser from "./DriveBrowser";

function str(me: MeDetailed, key: string): string {
  const v: unknown = me[key];
  return typeof v === "string" ? v : "";
}

function bool(me: MeDetailed, key: string, fallback = false): boolean {
  const v: unknown = me[key];
  return typeof v === "boolean" ? v : fallback;
}

function numNull(me: MeDetailed, key: string): string {
  const v: unknown = me[key];
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}

function listLines(me: MeDetailed, key: string): string {
  const v: unknown = me[key];
  return Array.isArray(v) ? v.filter((x) => typeof x === "string").join("\n") : "";
}

interface FieldPair {
  name: string;
  value: string;
}

function pairs(me: MeDetailed): FieldPair[] {
  const v: unknown = me["fields"];
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (f): f is { name?: unknown; value?: unknown } =>
        typeof f === "object" && f !== null,
    )
    .slice(0, 16)
    .map((f) => ({
      name: typeof f.name === "string" ? f.name : "",
      value: typeof f.value === "string" ? f.value : "",
    }));
}

function Check(props: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label class="check">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
      <span>
        {props.label}
        {props.hint ? <span class="handle"> — {props.hint}</span> : null}
      </span>
    </label>
  );
}

function TextField(props: {
  id: string;
  label: string;
  value: string;
  onInput: (v: string) => void;
  max?: number;
  placeholder?: string;
  textarea?: boolean;
}) {
  return (
    <div class="field">
      <label for={props.id}>{props.label}</label>
      <Show
        when={props.textarea}
        fallback={
          <input
            id={props.id}
            type="text"
            value={props.value}
            onInput={(e) => props.onInput(e.currentTarget.value)}
            maxlength={props.max}
            placeholder={props.placeholder}
          />
        }
      >
        <textarea
          id={props.id}
          value={props.value}
          onInput={(e) => props.onInput(e.currentTarget.value)}
          maxlength={props.max}
          placeholder={props.placeholder}
          aria-label={props.label}
        />
      </Show>
    </div>
  );
}

export default function ProfileEditor(props: {
  me: MeDetailed;
  onSaved: (me: MeDetailed) => void;
}) {
  const me = () => props.me;
  // Basic.
  const [name, setName] = createSignal(str(me(), "name"));
  const [description, setDescription] = createSignal(str(me(), "description"));
  const [location, setLocation] = createSignal(str(me(), "location"));
  const [birthday, setBirthday] = createSignal(str(me(), "birthday"));
  const [isLocked, setIsLocked] = createSignal(bool(me(), "isLocked"));
  const [isBot, setIsBot] = createSignal(bool(me(), "isBot"));
  const [followedMessage, setFollowedMessage] = createSignal(str(me(), "followedMessage"));
  const [lang, setLang] = createSignal(str(me(), "lang"));
  const [chatScope, setChatScope] = createSignal(str(me(), "chatScope"));
  const [pinnedPageId, setPinnedPageId] = createSignal(str(me(), "pinnedPageId"));
  // Media.
  const [avatarId, setAvatarId] = createSignal<string | null>(
    typeof me()["avatarId"] === "string" ? (me()["avatarId"] as string) : null,
  );
  const [bannerId, setBannerId] = createSignal<string | null>(
    typeof me()["bannerId"] === "string" ? (me()["bannerId"] as string) : null,
  );
  const [showAvatarPick, setShowAvatarPick] = createSignal(false);
  const [showBannerPick, setShowBannerPick] = createSignal(false);
  const [avatarDecorations, setAvatarDecorations] = createSignal(
    me()["avatarDecorations"] !== undefined
      ? JSON.stringify(me()["avatarDecorations"] ?? [])
      : "[]",
  );
  // Privacy / federation flags.
  const [hideOnlineStatus, setHideOnlineStatus] = createSignal(bool(me(), "hideOnlineStatus"));
  const [publicReactions, setPublicReactions] = createSignal(bool(me(), "publicReactions"));
  const [carefulBot, setCarefulBot] = createSignal(bool(me(), "carefulBot"));
  const [autoAcceptFollowed, setAutoAcceptFollowed] = createSignal(bool(me(), "autoAcceptFollowed"));
  const [noCrawle, setNoCrawle] = createSignal(bool(me(), "noCrawle"));
  const [preventAiLearning, setPreventAiLearning] = createSignal(bool(me(), "preventAiLearning"));
  const [requireSignin, setRequireSignin] = createSignal(
    bool(me(), "requireSigninToViewContents"),
  );
  const [requireSigninCut, setRequireSigninCut] = createSignal(
    bool(me(), "requireSigninToViewContentsOfCutContent"),
  );
  const [injectFeaturedNote, setInjectFeaturedNote] = createSignal(
    bool(me(), "injectFeaturedNote"),
  );
  const [receiveAnnouncementEmail, setReceiveAnnouncementEmail] = createSignal(
    bool(me(), "receiveAnnouncementEmail"),
  );
  const [alwaysMarkNsfw, setAlwaysMarkNsfw] = createSignal(bool(me(), "alwaysMarkNsfw"));
  const [autoSensitive, setAutoSensitive] = createSignal(bool(me(), "autoSensitive"));
  const [rejectQuotes, setRejectQuotes] = createSignal(bool(me(), "rejectQuotes"));
  // Timed gates (seconds, blank = unset).
  const [approvalBefore, setApprovalBefore] = createSignal(numNull(me(), "followApprovalBeforeSeconds"));
  const [approvalExpire, setApprovalExpire] = createSignal(
    numNull(me(), "followApprovalAutoExpirationSeconds"),
  );
  const [followersOnlyBefore, setFollowersOnlyBefore] = createSignal(
    numNull(me(), "makeNotesFollowersOnlyBefore"),
  );
  const [hiddenBefore, setHiddenBefore] = createSignal(numNull(me(), "makeNotesHiddenBefore"));
  // Structured.
  const [fields, setFields] = createSignal<FieldPair[]>(pairs(me()));
  const [mutedWords, setMutedWords] = createSignal(
    formatWordGroups(me()["mutedWords"] as string[][] | null),
  );
  const [hardMutedWords, setHardMutedWords] = createSignal(
    formatWordGroups(me()["hardMutedWords"] as string[][] | null),
  );
  const [mutedInstances, setMutedInstances] = createSignal(
    Array.isArray(me()["mutedInstances"])
      ? (me()["mutedInstances"] as string[]).join("\n")
      : "",
  );
  const [notificationConfig, setNotificationConfig] = createSignal(
    me()["notificationRecieveConfig"] !== undefined
      ? JSON.stringify(me()["notificationRecieveConfig"] ?? {})
      : "{}",
  );
  const [emailTypes, setEmailTypes] = createSignal(listLines(me(), "emailNotificationTypes"));
  const [alsoKnownAs, setAlsoKnownAs] = createSignal(listLines(me(), "alsoKnownAs"));

  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const numOrNull = (raw: string): number | null => {
    const t = raw.trim();
    if (t.length === 0) return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  };

  const save = async () => {
    if (saving()) return;
    setSaving(true);
    setError(null);
    try {
      let decorations: ProfileUpdateParams["avatarDecorations"] = [];
      try {
        const parsed: unknown = JSON.parse(avatarDecorations().trim() || "[]");
        if (!Array.isArray(parsed)) throw new Error("not an array");
        decorations = parsed.slice(0, 16);
      } catch {
        throw new Error("Avatar decorations must be a JSON array (max 16).");
      }
      let notifConfig: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(notificationConfig().trim() || "{}");
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("not an object");
        }
        notifConfig = parsed as Record<string, unknown>;
      } catch {
        throw new Error("Notification receive config must be a JSON object.");
      }
      const params: ProfileUpdateParams = {
        name: name().trim(),
        description: description().trim(),
        location: location().trim(),
        birthday: birthday().trim() === "" ? null : birthday().trim(),
        isLocked: isLocked(),
        isBot: isBot(),
        followedMessage: followedMessage() === "" ? null : followedMessage(),
        lang: lang().trim() === "" ? null : lang().trim(),
        avatarId: avatarId(),
        bannerId: bannerId(),
        avatarDecorations: decorations,
        hideOnlineStatus: hideOnlineStatus(),
        publicReactions: publicReactions(),
        carefulBot: carefulBot(),
        autoAcceptFollowed: autoAcceptFollowed(),
        followApprovalBeforeSeconds: numOrNull(approvalBefore()),
        followApprovalAutoExpirationSeconds: numOrNull(approvalExpire()),
        noCrawle: noCrawle(),
        preventAiLearning: preventAiLearning(),
        requireSigninToViewContents: requireSignin(),
        requireSigninToViewContentsOfCutContent: requireSigninCut(),
        makeNotesFollowersOnlyBefore: numOrNull(followersOnlyBefore()),
        makeNotesHiddenBefore: numOrNull(hiddenBefore()),
        injectFeaturedNote: injectFeaturedNote(),
        receiveAnnouncementEmail: receiveAnnouncementEmail(),
        alwaysMarkNsfw: alwaysMarkNsfw(),
        autoSensitive: autoSensitive(),
        chatScope: chatScope().trim() === "" ? null : chatScope().trim(),
        pinnedPageId: pinnedPageId().trim() === "" ? null : pinnedPageId().trim(),
        mutedWords: parseWordGroups(mutedWords()),
        hardMutedWords: parseWordGroups(hardMutedWords()),
        mutedInstances: parseMutedInstances(mutedInstances()),
        notificationRecieveConfig: notifConfig,
        emailNotificationTypes: emailTypes()
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
        alsoKnownAs: alsoKnownAs()
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
        rejectQuotes: rejectQuotes(),
      };
      const updated = await apiCall<MeDetailed>("i/update", params as Record<string, unknown>);
      props.onSaved(updated);
    } catch (err) {
      setError(
        isPermissionError(err)
          ? "Your session lacks the profile-edit permission. Sign out and sign in again, then retry."
          : err instanceof Error
            ? err.message
            : "Could not save the profile.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="form">
      <h3>Basic</h3>
      <TextField id="profile-name" label="Display name" value={name()} onInput={setName} max={50} />
      <TextField id="profile-description" label="Bio" value={description()} onInput={setDescription} max={1500} textarea />
      <TextField id="profile-location" label="Location" value={location()} onInput={setLocation} max={50} />
      <TextField id="profile-birthday" label="Birthday (YYYY-MM-DD, blank to clear)" value={birthday()} onInput={setBirthday} placeholder="YYYY-MM-DD" />
      <TextField id="profile-followed" label="Followed message" value={followedMessage()} onInput={setFollowedMessage} max={200} textarea />
      <TextField id="profile-lang" label="Language (e.g. en)" value={lang()} onInput={setLang} max={10} />
      <Check label="Locked account (approve followers)" checked={isLocked()} onChange={setIsLocked} />
      <Check label="This is a bot account" checked={isBot()} onChange={setIsBot} />

      <h3>Avatar & banner</h3>
      <p class="handle">Upload in Drive, then select the file. Saving applies it.</p>
      <div class="row">
        <button type="button" onClick={() => setShowAvatarPick((v) => !v)} aria-expanded={showAvatarPick()}>
          {avatarId() ? "Change avatar…" : "Choose avatar…"}
        </button>
        <Show when={avatarId()}>
          <button type="button" onClick={() => setAvatarId(null)}>Clear avatar</button>
        </Show>
      </div>
      <Show when={showAvatarPick()}>
        <DriveBrowser
          selectMode
          selectedIds={avatarId() ? [avatarId()!] : []}
          onToggleSelect={(f: DriveFile) => setAvatarId((cur) => (cur === f.id ? null : f.id))}
        />
      </Show>
      <div class="row">
        <button type="button" onClick={() => setShowBannerPick((v) => !v)} aria-expanded={showBannerPick()}>
          {bannerId() ? "Change banner…" : "Choose banner…"}
        </button>
        <Show when={bannerId()}>
          <button type="button" onClick={() => setBannerId(null)}>Clear banner</button>
        </Show>
      </div>
      <Show when={showBannerPick()}>
        <DriveBrowser
          selectMode
          selectedIds={bannerId() ? [bannerId()!] : []}
          onToggleSelect={(f: DriveFile) => setBannerId((cur) => (cur === f.id ? null : f.id))}
        />
      </Show>
      <TextField id="profile-deco" label="Avatar decorations (JSON array, max 16)" value={avatarDecorations()} onInput={setAvatarDecorations} textarea />

      <h3>Profile fields (max 16)</h3>
      <For each={fields()}>
        {(pair, i) => (
          <div class="row">
            <input
              type="text"
              value={pair.name}
              onInput={(e) =>
                setFields((list) => list.map((p, j) => (j === i() ? { ...p, name: e.currentTarget.value } : p)))
              }
              placeholder="Name"
              maxlength={50}
              aria-label={`Field ${i() + 1} name`}
            />
            <input
              type="text"
              value={pair.value}
              onInput={(e) =>
                setFields((list) => list.map((p, j) => (j === i() ? { ...p, value: e.currentTarget.value } : p)))
              }
              placeholder="Value"
              maxlength={200}
              aria-label={`Field ${i() + 1} value`}
            />
            <button
              type="button"
              onClick={() => setFields((list) => list.filter((_, j) => j !== i()))}
              aria-label={`Remove field ${i() + 1}`}
            >
              ×
            </button>
          </div>
        )}
      </For>
      <Show when={fields().length < 16}>
        <button type="button" onClick={() => setFields((list) => [...list, { name: "", value: "" }])}>
          Add field
        </button>
      </Show>

      <h3>Privacy & federation</h3>
      <Check label="Hide online status" checked={hideOnlineStatus()} onChange={setHideOnlineStatus} />
      <Check label="Public reactions (others can see what you reacted to)" checked={publicReactions()} onChange={setPublicReactions} />
      <Check label="Careful bot (interact only with consenting bots)" checked={carefulBot()} onChange={setCarefulBot} />
      <Check label="Auto-accept followed users" hint="automatically follow back users you follow" checked={autoAcceptFollowed()} onChange={setAutoAcceptFollowed} />
      <Check label="Do not index (noCrawle)" checked={noCrawle()} onChange={setNoCrawle} />
      <Check label="Prevent AI learning" checked={preventAiLearning()} onChange={setPreventAiLearning} />
      <Check label="Require sign-in to view contents" checked={requireSignin()} onChange={setRequireSignin} />
      <Check label="Require sign-in for cut (long) content" checked={requireSigninCut()} onChange={setRequireSigninCut} />
      <Check label="Reject quotes (do not let others quote your notes)" checked={rejectQuotes()} onChange={setRejectQuotes} />
      <Check label="Inject featured note into timeline" checked={injectFeaturedNote()} onChange={setInjectFeaturedNote} />
      <Check label="Receive announcement email" checked={receiveAnnouncementEmail()} onChange={setReceiveAnnouncementEmail} />
      <Check label="Always mark uploads NSFW" checked={alwaysMarkNsfw()} onChange={setAlwaysMarkNsfw} />
      <Check label="Auto-mark media sensitive" checked={autoSensitive()} onChange={setAutoSensitive} />
      <TextField id="profile-approval-before" label="Follow approval window starts (seconds, blank = unset)" value={approvalBefore()} onInput={setApprovalBefore} placeholder="e.g. 86400" />
      <TextField id="profile-approval-expire" label="Follow approval auto-expiry (seconds, blank = unset)" value={approvalExpire()} onInput={setApprovalExpire} placeholder="e.g. 604800" />
      <TextField id="profile-followers-before" label="Make notes followers-only before (seconds, blank = unset)" value={followersOnlyBefore()} onInput={setFollowersOnlyBefore} />
      <TextField id="profile-hidden-before" label="Make notes hidden before (seconds, blank = unset)" value={hiddenBefore()} onInput={setHiddenBefore} />
      <TextField id="profile-chat" label="Chat scope" value={chatScope()} onInput={setChatScope} placeholder="e.g. everyone" />
      <TextField id="profile-page" label="Pinned page id" value={pinnedPageId()} onInput={setPinnedPageId} />

      <h3>Mutes</h3>
      <TextField id="profile-muted-words" label="Muted words (one AND-group per line, words separated by spaces — matched notes hide behind a warning)" value={mutedWords()} onInput={setMutedWords} textarea />
      <TextField id="profile-hard-words" label="Hard-muted words (same format — matched notes are hidden)" value={hardMutedWords()} onInput={setHardMutedWords} textarea />
      <TextField id="profile-muted-instances" label="Muted instances (one host per line — their notes are hidden)" value={mutedInstances()} onInput={setMutedInstances} textarea />

      <h3>Notifications & identity</h3>
      <TextField id="profile-notif-config" label="Notification receive config (JSON object)" value={notificationConfig()} onInput={setNotificationConfig} textarea />
      <TextField id="profile-email-types" label="Email notification types (comma or line separated)" value={emailTypes()} onInput={setEmailTypes} textarea />
      <TextField id="profile-aka" label="Also known as (one account URI per line)" value={alsoKnownAs()} onInput={setAlsoKnownAs} textarea />

      <Show when={error()}>
        <div class="err" role="alert">{error()}</div>
      </Show>
      <button type="button" class="btn-primary" disabled={saving()} onClick={save}>
        {saving() ? "Saving…" : "Save profile"}
      </button>
    </div>
  );
}
