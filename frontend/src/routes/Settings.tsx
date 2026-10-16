// Client settings, organized into pages like the reference client: the
// `/settings` index lists sections, each with its own detail route.
// Only sections that exist are listed — nothing inert, no stubs.
//
// - Your account (`/settings/account`): session info + sign out.
// - Accessibility and display (`/settings/display`): device-local
//   appearance (colour mode, text size), available signed out too.
// - Reactions and emoji (`/settings/reactions`): device-local like
//   emoji + favourites management (the picker right-click menu is the
//   main path; this page is the keyboard/touch equivalent).
//
// Profile editing lives ONLY on your own profile page ("Edit profile"
// button) — never in client settings.

import { For, Show, createEffect, createSignal, onMount } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { useAuth } from "../state/auth";
import { ApiError, apiCall, isPermissionError, isUnsupportedError } from "../api/client";
import { TEXT_SCALE_MAX, TEXT_SCALE_MIN, useAppearance } from "../state/appearance";
import type { ColorMode } from "../state/appearance";
import { useEmojiPrefs } from "../state/emojiPrefs";
import { DEFAULT_LIKE_EMOJI } from "../api/emoji";
import { DisplayName, EmojiGlyph } from "../components/EmojiPicker";
import { BACKEND_URL } from "../api/backend";
import { displayNameOf, handleOf, hasRealDisplayName, headNameOf } from "../api/types";
import type { MeDetailed, UserLite, UserRelation } from "../api/types";
import {
  blockUser,
  fetchRelations,
  listBlocks,
  listMutes,
  listRenoteMutes,
  muteRenotes,
  muteUser,
  unblockUser,
  unmuteRenotes,
  unmuteUser,
} from "../api/mutes";
import {
  WordFilterParseError,
  formatWordFilters,
  parseMutedInstances,
  parseWordFilters,
} from "../api/softMute";
import {
  downloadJson,
  exportData,
  importData,
  readImportFile,
  type ExportKind,
  type ImportKind,
} from "../api/importExport";
import { tryPersistLikeEmoji } from "../api/likeEmoji";
import LoadingState from "../components/LoadingState";

const COLOR_MODES: Array<{ value: ColorMode; label: string; hint: string }> = [
  { value: "system", label: "Follow system", hint: "Matches your device setting" },
  { value: "light", label: "Light", hint: "Always light" },
  { value: "dark", label: "Dark", hint: "Always dark" },
];

const SECTIONS = [
  {
    href: "/settings/account",
    title: "Your account",
    hint: "Session info and sign out",
  },
  {
    href: "/settings/display",
    title: "Accessibility and display",
    hint: "Colour mode and text size",
  },
  {
    href: "/settings/reactions",
    title: "Reactions and emoji",
    hint: "Like emoji and favourites",
  },
  {
    href: "/settings/mutes",
    title: "Mutes and blocks",
    hint: "Word, instance, account, and repost mutes plus blocks",
  },
  {
    href: "/settings/import",
    title: "Import",
    hint: "Following, blocks, mutes, notes from a file",
  },
  {
    href: "/settings/export",
    title: "Export",
    hint: "Download your data",
  },
];

/** Index: the section list. Static — no auth gate needed. */
export default function Settings() {
  return (
    <div>
      <div class="pagehead">
        <h1>Settings</h1>
      </div>
      <nav class="settings-list" aria-label="Settings sections">
        {SECTIONS.map((section) => (
          <A class="settings-row" href={section.href}>
            <span class="settings-row-text">
              <span class="settings-row-title">{section.title}</span>
              <span class="settings-row-hint">{section.hint}</span>
            </span>
            <span class="settings-row-chevron" aria-hidden="true">›</span>
          </A>
        ))}
      </nav>
    </div>
  );
}

function BackToSettings() {
  return <A class="action" href="/settings">Back to settings</A>;
}

export function AccountSettings() {
  const auth = useAuth();
  const navigate = useNavigate();
  // Sharkey quote refusal (§4): account-wide `rejectQuotes` via `i/update`.
  // 404/400 hides the switch (unsupported) — never an inert toggle.
  const [quotesSupported, setQuotesSupported] = createSignal(true);
  const [rejectQuotes, setRejectQuotes] = createSignal<boolean | null>(null);
  const [quotesBusy, setQuotesBusy] = createSignal(false);
  const [quotesError, setQuotesError] = createSignal<string | null>(null);

  onMount(() => {
    const me = auth.me() as MeDetailed | null;
    const current: unknown = me?.["rejectQuotes"];
    if (typeof current === "boolean") setRejectQuotes(current);
    else if (me) {
      // Unknown: probe with a no-op read is impossible, so leave the
      // switch visible and let the first save decide support.
      setRejectQuotes(false);
    }
  });

  const saveQuotes = async (value: boolean) => {
    setRejectQuotes(value);
    if (quotesBusy()) return;
    setQuotesBusy(true);
    setQuotesError(null);
    try {
      const updated = await apiCall<MeDetailed>("i/update", { rejectQuotes: value });
      const current: unknown = updated["rejectQuotes"];
      if (typeof current === "boolean") setRejectQuotes(current);
      setQuotesSupported(true);
      await auth.refreshMe().catch(() => undefined);
    } catch (err) {
      if (isUnsupportedError(err)) {
        setQuotesSupported(false);
      } else {
        setQuotesError(err instanceof Error ? err.message : "Could not save quote refusal.");
      }
    } finally {
      setQuotesBusy(false);
    }
  };

  const signout = () => {
    auth.signout();
    navigate("/login");
  };

  return (
    <Show when={auth.authReady()} fallback={<LoadingState />}>
      <div class="pagehead">
        <h1>Your account</h1>
        <BackToSettings />
      </div>
      <Show
        when={auth.me()}
        fallback={
          <div class="state">
            <p>You are signed out.</p>
            <A href="/login">Sign in</A>
          </div>
        }
      >
        {(user) => (
          <div class="settings-block">
            <p class="handle">
              {auth.isExternalActive()
                ? `External account on ${auth.activeExternalHost() ?? "unknown host"}`
                : `${auth.backendLabel} (${BACKEND_URL})`}
            </p>
            <p>
              <DisplayName name={headNameOf(user())} packed={user().emojis} host={user().host} />
              <Show when={hasRealDisplayName(user())}>
                <> ({handleOf(user())})</>
              </Show>
            </p>
            <Show when={auth.isExternalActive()}>
              <p class="handle">
                Live updates are off for external accounts — timelines
                still load and refresh normally.
              </p>
            </Show>
            <p class="handle">
              To change accounts, use Switch account in the account menu.
            </p>
            <Show when={quotesSupported() && rejectQuotes() !== null}>
              <h2>Quotes</h2>
              <label class="check">
                <input
                  type="checkbox"
                  checked={rejectQuotes() ?? false}
                  disabled={quotesBusy()}
                  onChange={(e) => void saveQuotes(e.currentTarget.checked)}
                />
                <span>
                  Reject quotes
                  <span class="handle"> — others cannot quote your notes</span>
                </span>
              </label>
              <Show when={quotesError()}>
                <div class="err" role="alert">{quotesError()}</div>
              </Show>
            </Show>
            <button type="button" onClick={signout}>
              Sign out
            </button>
          </div>
        )}
      </Show>
    </Show>
  );
}

function AppearanceBlock() {
  const appearance = useAppearance();

  return (
    <div class="settings-block appearance">
      <fieldset>
        <legend>Colour mode</legend>
        <div class="radio-rows">
          {COLOR_MODES.map((option) => (
            <label>
              <input
                type="radio"
                name="keystone-color-mode"
                value={option.value}
                checked={appearance.colorMode() === option.value}
                onChange={() => appearance.setColorMode(option.value)}
              />
              <span>
                {option.label}
                <span class="handle"> — {option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Text size</legend>
        <p class="handle">
          Scales all text across the app from 50% to 400%. Spacing,
          icons, and images stay fixed — only text changes size.
        </p>
        <div class="scale-row">
          <input
            type="range"
            id="keystone-text-scale"
            min={TEXT_SCALE_MIN}
            max={TEXT_SCALE_MAX}
            step={0.1}
            value={appearance.textScale()}
            onInput={(e) => appearance.setTextScale(parseFloat(e.currentTarget.value))}
            aria-describedby="keystone-text-scale-value"
          />
          <output id="keystone-text-scale-value" for="keystone-text-scale">
            {Math.round(appearance.textScale() * 100)}%
          </output>
        </div>
        <div class="scale-row">
          <span class="handle">{TEXT_SCALE_MIN * 100}%</span>
          <span class="spacer" aria-hidden="true" />
          <button
            type="button"
            onClick={() => appearance.setTextScale(1)}
            disabled={appearance.textScale() === 1}
          >
            Reset to 100%
          </button>
          <span class="spacer" aria-hidden="true" />
          <span class="handle">{TEXT_SCALE_MAX * 100}%</span>
        </div>
        <p class="settings-preview" aria-label="Text size preview">
          Preview: text looks like this at your chosen size.
        </p>
      </fieldset>
    </div>
  );
}

export function DisplaySettings() {
  return (
    <div>
      <div class="pagehead">
        <h1>Accessibility and display</h1>
        <BackToSettings />
      </div>
      <AppearanceBlock />
    </div>
  );
}

export function ReactionsSettings() {
  const prefs = useEmojiPrefs();
  const auth = useAuth();
  const like = () => prefs.likeEmoji();
  const isDefault = () => like() === DEFAULT_LIKE_EMOJI;
  // Server persistence (§8): per-account like emoji once the backend
  // offers a field; localStorage stays the fallback when it 404s.
  const [persisted, setPersisted] = createSignal<boolean | null>(null);

  const persistLike = async (emoji: string) => {
    prefs.setLikeEmoji(emoji);
    setPersisted(await tryPersistLikeEmoji(emoji));
  };

  return (
    <div>
      <div class="pagehead">
        <h1>Reactions and emoji</h1>
        <BackToSettings />
      </div>
      <div class="settings-block">
        <h2>Like emoji</h2>
        <p class="handle">
          The like button reacts with this instead of the heart.
          Right-click any emoji in the picker to change it.
        </p>
        <p class="like-current">
          <EmojiGlyph emoji={like()} /> <span>{like()}</span>
        </p>
        <Show when={persisted() === false}>
          <p class="handle">This server does not store a like emoji, so it stays on this device.</p>
        </Show>
        <button
          type="button"
          disabled={isDefault()}
          onClick={() => void persistLike(DEFAULT_LIKE_EMOJI)}
        >
          Reset to heart
        </button>
      </div>
      <div class="settings-block">
        <h2>Favourites</h2>
        <p class="handle">
          Pinned at the top of the picker. Right-click any picker emoji
          to add it here.
        </p>
        <Show
          when={prefs.favourites().length > 0}
          fallback={<p class="handle">No favourites yet.</p>}
        >
          <div class="favlist">
            <For each={prefs.favourites()}>
              {(emoji) => (
                <span class="favrow">
                  <EmojiGlyph emoji={emoji} />
                  <button
                    type="button"
                    onClick={() => prefs.removeFavourite(emoji)}
                    aria-label={`Remove ${emoji} from favourites`}
                  >
                    Remove
                  </button>
                </span>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

function UserRow(props: { user: UserLite; action: string; busy: boolean; onAct: () => void }) {
  return (
    <div class="notif">
      <A
        class="avatarlink"
        href={`/users/${props.user.id}`}
        aria-label={`Open profile of ${displayNameOf(props.user)}`}
      >
        <Show
          when={props.user.avatarUrl}
          fallback={
            <div class="avatar-fallback" aria-hidden="true">
              {displayNameOf(props.user).slice(0, 1).toUpperCase()}
            </div>
          }
        >
          <img class="avatar" src={props.user.avatarUrl!} alt="" loading="lazy" />
        </Show>
      </A>
      <div class="notif-main">
        <div class="notif-head">
          <A class="namelink" href={`/users/${props.user.id}`}>
            <span class="name">{displayNameOf(props.user)}</span>
            <span class="handle">{handleOf(props.user)}</span>
          </A>
        </div>
        <div class="optrow">
          <button type="button" class="minibtn" disabled={props.busy} onClick={props.onAct}>
            {props.action}
          </button>
        </div>
      </div>
    </div>
  );
}

type MuteWordFieldName = "mutedWords" | "hardMutedWords" | "mutedInstances";

/** True when the server has no such field or endpoint here: Misskey-family
 * 404, or Pinetree's 400 UNSUPPORTED_FIELD for `i/update` fields outside
 * its subset. Either way the UI answers with an honest unavailable note,
 * never an error. */
function fieldUnavailable(err: unknown): boolean {
  if (isUnsupportedError(err)) return true;
  return err instanceof ApiError && err.status === 400 && err.code === "UNSUPPORTED_FIELD";
}

const PERMISSION_HINT =
  "Your session lacks the permission for this. Sign out and sign in again, then retry.";

/** One `i/update` word/instance mute editor (soft words, hard words, or
 * instance hosts). Same backend fields the profile editor saves — managed
 * here alongside the account lists, in Keystone settings language. */
function MuteWordField(props: {
  field: MuteWordFieldName;
  title: string;
  description: string;
  placeholder: string;
  initial: () => string;
}) {
  const auth = useAuth();
  const [value, setValue] = createSignal(props.initial());
  const [dirty, setDirty] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [unavailable, setUnavailable] = createSignal(false);

  // The account record can arrive after this page mounts; adopt it until
  // the user edits (a save refreshes the record and re-seeds the text).
  createEffect(() => {
    if (!dirty()) setValue(props.initial());
  });

  const save = async () => {
    if (busy()) return;
    setError(null);
    setNotice(null);
    // An invalid regular expression aborts before any request — the same
    // line-numbered refusal as the reference editor.
    let parsed: Array<string | string[]> | string[];
    try {
      parsed =
        props.field === "mutedInstances"
          ? parseMutedInstances(value())
          : parseWordFilters(value());
    } catch (err) {
      setError(
        err instanceof WordFilterParseError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not save.",
      );
      return;
    }
    setBusy(true);
    try {
      await apiCall<MeDetailed>("i/update", { [props.field]: parsed });
      await auth.refreshMe().catch(() => undefined);
      setDirty(false);
      setNotice("Saved.");
    } catch (err) {
      if (fieldUnavailable(err)) setUnavailable(true);
      else if (isPermissionError(err)) setError(PERMISSION_HINT);
      else setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="settings-block">
      <h2>{props.title}</h2>
      <Show
        when={!unavailable()}
        fallback={<p class="handle">Not available on this server.</p>}
      >
        <p class="handle">{props.description}</p>
        <textarea
          rows={3}
          value={value()}
          placeholder={props.placeholder}
          aria-label={props.title}
          onInput={(e) => {
            setValue(e.currentTarget.value);
            setDirty(true);
            setNotice(null);
          }}
        />
        <div class="optrow">
          <button type="button" disabled={busy()} onClick={() => void save()}>
            {busy() ? "Saving…" : "Save"}
          </button>
          <Show when={notice()}>
            <span role="status">{notice()}</span>
          </Show>
        </div>
        <Show when={error()}>
          <div class="errorbox" role="alert">{error()}</div>
        </Show>
      </Show>
    </div>
  );
}

/** Mute or block an account from settings: search, then relation-driven
 * toggles (same wrappers as the profile actions). Falls back to
 * create-only buttons when the relation endpoint is missing; the whole
 * block hides when user search itself is unsupported. */
function MuteBlockSearch(props: { myId: string | null; onChanged: () => void }) {
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<UserLite[]>([]);
  const [relations, setRelations] = createSignal<Record<string, UserRelation>>({});
  const [relationsLive, setRelationsLive] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [actBusy, setActBusy] = createSignal(false);
  const [searched, setSearched] = createSignal(false);
  const [searchDead, setSearchDead] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const syncRelations = async (users: UserLite[]) => {
    try {
      const rels = await fetchRelations(users.map((u) => u.id));
      const map: Record<string, UserRelation> = {};
      for (const r of rels) map[r.id] = r;
      setRelations(map);
      setRelationsLive(true);
    } catch (relErr) {
      if (isUnsupportedError(relErr)) setRelationsLive(false);
      else throw relErr;
    }
  };

  const run = async () => {
    const q = query().trim();
    if (q.length === 0 || busy()) return;
    setBusy(true);
    setError(null);
    try {
      const users = await apiCall<UserLite[]>("users/search", { query: q, limit: 10 });
      setResults(users);
      setSearched(true);
      await syncRelations(users);
    } catch (err) {
      if (fieldUnavailable(err)) setSearchDead(true);
      else setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  };

  const act = async (userId: string, fn: () => Promise<unknown>) => {
    if (actBusy()) return;
    setActBusy(true);
    setError(null);
    try {
      await fn();
      if (relationsLive()) {
        try {
          await syncRelations(results());
        } catch {
          // The lists below still refresh; relation state retries next search.
        }
      }
      props.onChanged();
    } catch (err) {
      if (isPermissionError(err)) setError(PERMISSION_HINT);
      else setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setActBusy(false);
    }
  };

  const toggle = (
    user: UserLite,
    active: boolean | undefined,
    onLabel: string,
    offLabel: string,
    on: () => Promise<unknown>,
    off: () => Promise<unknown>,
  ) => (
    <Show
      when={active}
      fallback={
        <button
          type="button"
          class="minibtn"
          disabled={actBusy()}
          onClick={() => void act(user.id, on)}
        >
          {onLabel}
        </button>
      }
    >
      <button
        type="button"
        class="minibtn"
        disabled={actBusy()}
        onClick={() => void act(user.id, off)}
      >
        {offLabel}
      </button>
    </Show>
  );

  const searchRow = (user: UserLite) => {
    const rel = () => relations()[user.id];
    const self = () => props.myId !== null && props.myId === user.id;
    return (
      <div class="notif">
        <A
          class="avatarlink"
          href={`/users/${user.id}`}
          aria-label={`Open profile of ${displayNameOf(user)}`}
        >
          <Show
            when={user.avatarUrl}
            fallback={
              <div class="avatar-fallback" aria-hidden="true">
                {displayNameOf(user).slice(0, 1).toUpperCase()}
              </div>
            }
          >
            <img class="avatar" src={user.avatarUrl!} alt="" loading="lazy" />
          </Show>
        </A>
        <div class="notif-main">
          <div class="notif-head">
            <A class="namelink" href={`/users/${user.id}`}>
              <span class="name">{displayNameOf(user)}</span>
              <span class="handle">{handleOf(user)}</span>
            </A>
          </div>
          <Show when={!self()} fallback={<span class="handle">This is you.</span>}>
            <div class="optrow">
              <Show
                when={relationsLive() && rel()}
                fallback={
                  <>
                    <button
                      type="button"
                      class="minibtn"
                      disabled={actBusy()}
                      onClick={() => void act(user.id, () => muteUser(user.id))}
                    >
                      Mute
                    </button>
                    <button
                      type="button"
                      class="minibtn"
                      disabled={actBusy()}
                      onClick={() => void act(user.id, () => muteRenotes(user.id))}
                    >
                      Mute reposts
                    </button>
                    <button
                      type="button"
                      class="minibtn"
                      disabled={actBusy()}
                      onClick={() => void act(user.id, () => blockUser(user.id))}
                    >
                      Block
                    </button>
                  </>
                }
              >
                {(r) => (
                  <>
                    {toggle(user, r().isMuted, "Mute", "Unmute", () => muteUser(user.id), () => unmuteUser(user.id))}
                    {toggle(user, r().isRenoteMuted, "Mute reposts", "Unmute reposts", () => muteRenotes(user.id), () => unmuteRenotes(user.id))}
                    {toggle(user, r().isBlocking, "Block", "Unblock", () => blockUser(user.id), () => unblockUser(user.id))}
                  </>
                )}
              </Show>
            </div>
          </Show>
        </div>
      </div>
    );
  };

  return (
    <div class="settings-block">
      <h2>Mute or block an account</h2>
      <Show
        when={!searchDead()}
        fallback={<p class="handle">Not available on this server.</p>}
      >
        <p class="handle">
          Search for an account, then mute, repost-mute, or block it. The lists below update too.
        </p>
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <input
            type="text"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="Username…"
            aria-label="Search accounts"
            style={{ flex: 1 }}
          />
          <button type="submit" disabled={busy() || query().trim().length === 0}>
            {busy() ? "Searching…" : "Search"}
          </button>
        </form>
        <Show when={searched() && results().length === 0 && !busy()}>
          <p class="handle">No accounts found.</p>
        </Show>
        <For each={results()}>{(u) => searchRow(u)}</For>
        <Show when={error()}>
          <div class="errorbox" role="alert">{error()}</div>
        </Show>
      </Show>
    </div>
  );
}

/** Mutes and blocks: word/instance filters plus blocked, muted, and
 * repost-muted accounts with search-to-add and unblock/unmute. Each
 * section gates independently — unsupported backends render an honest
 * unavailable state instead of an error. */
export function MutesSettings() {
  const auth = useAuth();
  const [blocks, setBlocks] = createSignal<UserLite[]>([]);
  const [mutes, setMutes] = createSignal<UserLite[]>([]);
  const [renoteMutes, setRenoteMutes] = createSignal<UserLite[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [unsupported, setUnsupported] = createSignal<string[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    const missing: string[] = [];
    try {
      setBlocks(await listBlocks().catch((err) => {
        if (isUnsupportedError(err)) missing.push("blocks");
        else throw err;
        return [];
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load blocks.");
    }
    try {
      setMutes(await listMutes().catch((err) => {
        if (isUnsupportedError(err)) missing.push("mutes");
        else throw err;
        return [];
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load mutes.");
    }
    try {
      setRenoteMutes(await listRenoteMutes().catch((err) => {
        if (isUnsupportedError(err)) missing.push("repost mutes");
        else throw err;
        return [];
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load repost mutes.");
    }
    setUnsupported(missing);
    if (!quiet) setLoading(false);
  };

  onMount(() => {
    if (auth.token()) void load();
    else setLoading(false);
  });

  const act = async (fn: () => Promise<unknown>) => {
    if (busy()) return;
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  const hidden = (name: string) => unsupported().includes(name);

  const myId = () => (auth.me() as MeDetailed | null)?.id ?? null;
  const wordInitial =
    (field: "mutedWords" | "hardMutedWords"): (() => string) =>
    () =>
      formatWordFilters(
        (auth.me() as MeDetailed | null)?.[field] as Array<string | string[]> | undefined,
      );
  const instanceInitial = (): string => {
    const raw = (auth.me() as MeDetailed | null)?.["mutedInstances"];
    return Array.isArray(raw) ? (raw as string[]).join("\n") : "";
  };

  return (
    <div>
      <div class="pagehead">
        <h1>Mutes and blocks</h1>
        <BackToSettings />
      </div>
      <Show when={auth.authReady()} fallback={<LoadingState />}>
        <Show
          when={auth.token()}
          fallback={
            <div class="state">
              <p>You need to sign in to manage mutes and blocks.</p>
              <A href="/login">Sign in</A>
            </div>
          }
        >
          <Show when={loading()} fallback={
            <>
              <Show when={error()}>
                <div class="state" role="alert"><div class="errorbox">{error()}</div></div>
              </Show>
              <Show when={unsupported().length === 3}>
                <div class="state" role="status">
                  <p>Mutes and blocks are not available on this server.</p>
                </div>
              </Show>
              <MuteWordField
                field="mutedWords"
                title="Word mute"
                description="Notes matching these words hide behind a warning. One line per group (groups are ORed); words on a line must all match (AND). Surround a keyword with slashes for a regular expression."
                placeholder="one group per line…"
                initial={wordInitial("mutedWords")}
              />
              <MuteWordField
                field="hardMutedWords"
                title="Hard word mute"
                description="Notes matching these words are hidden entirely. Same format: AND within a line, OR across lines, /regex/ supported."
                placeholder="one group per line…"
                initial={wordInitial("hardMutedWords")}
              />
              <MuteWordField
                field="mutedInstances"
                title="Instance mutes"
                description="Notes from these instances are hidden entirely. One host per line."
                placeholder="one host per line…"
                initial={instanceInitial}
              />
              <MuteBlockSearch myId={myId()} onChanged={() => void load(true)} />
              <Show when={!hidden("repost mutes")}>
                <div class="settings-block">
                  <h2>Repost-muted ({renoteMutes().length})</h2>
                  <Show when={renoteMutes().length > 0} fallback={<p class="handle">None.</p>}>
                    <For each={renoteMutes()}>
                      {(u) => <UserRow user={u} action="Unmute reposts" busy={busy()} onAct={() => void act(() => unmuteRenotes(u.id))} />}
                    </For>
                  </Show>
                </div>
              </Show>
              <Show when={!hidden("mutes")}>
                <div class="settings-block">
                  <h2>Muted ({mutes().length})</h2>
                  <Show when={mutes().length > 0} fallback={<p class="handle">None.</p>}>
                    <For each={mutes()}>
                      {(u) => <UserRow user={u} action="Unmute" busy={busy()} onAct={() => void act(() => unmuteUser(u.id))} />}
                    </For>
                  </Show>
                </div>
              </Show>
              <Show when={!hidden("blocks")}>
                <div class="settings-block">
                  <h2>Blocked ({blocks().length})</h2>
                  <Show when={blocks().length > 0} fallback={<p class="handle">None.</p>}>
                    <For each={blocks()}>
                      {(u) => <UserRow user={u} action="Unblock" busy={busy()} onAct={() => void act(() => unblockUser(u.id))} />}
                    </For>
                  </Show>
                </div>
              </Show>
              <Show when={unsupported().length > 0 && unsupported().length < 3}>
                <div class="state" role="status">
                  <p>Not available on this server: {unsupported().join(", ")}.</p>
                </div>
              </Show>
            </>
          }>
            <LoadingState />
          </Show>
        </Show>
      </Show>
    </div>
  );
}

const IMPORT_KINDS: Array<{ id: ImportKind; label: string; hint: string }> = [
  { id: "following", label: "Following", hint: "Misskey-compatible following export file" },
  { id: "blocking", label: "Blocks", hint: "Misskey-compatible blocking export file" },
  { id: "mute", label: "Mutes", hint: "Misskey-compatible mute export file" },
  { id: "notes", label: "Notes", hint: "Misskey-compatible notes export file" },
];

/** Import (§14): Misskey-compatible files first. Size/type guarded, with a
 * per-file result report. 404-gated per kind. */
export function ImportSettings() {
  const auth = useAuth();
  const [results, setResults] = createSignal<Record<string, string>>({});
  const [busy, setBusy] = createSignal<string | null>(null);

  const pick = async (kind: ImportKind, files: FileList | null) => {
    const file = files?.[0];
    if (!file || busy() !== null) return;
    setBusy(kind);
    try {
      const content = await readImportFile(file);
      const res = await importData(kind, content);
      setResults((r) => ({ ...r, [kind]: res.message }));
    } catch (err) {
      if (isUnsupportedError(err)) {
        setResults((r) => ({ ...r, [kind]: "Import is not available on this server." }));
      } else {
        setResults((r) => ({ ...r, [kind]: err instanceof Error ? err.message : "Import failed." }));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div class="pagehead">
        <h1>Import</h1>
        <BackToSettings />
      </div>
      <Show when={auth.authReady()} fallback={<LoadingState />}>
        <Show
          when={auth.token()}
          fallback={
            <div class="state">
              <p>You need to sign in to import data.</p>
              <A href="/login">Sign in</A>
            </div>
          }
        >
          <For each={IMPORT_KINDS}>
            {(kind) => (
              <div class="settings-block">
                <h2>{kind.label}</h2>
                <p class="handle">{kind.hint}</p>
                <label class="btn-primary" style={{ padding: "0.4em 0.8em", border: "1px solid var(--text)", "border-radius": "6px", cursor: "pointer" }}>
                  Choose file
                  <input
                    type="file"
                    accept=".json,.csv,application/json,text/csv"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      void pick(kind.id, e.currentTarget.files);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                <Show when={busy() === kind.id}>
                  <p class="handle" role="status">Importing…</p>
                </Show>
                <Show when={results()[kind.id]}>
                  <p role="status">{results()[kind.id]}</p>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
}

const EXPORT_KINDS: Array<{ id: ExportKind; label: string }> = [
  { id: "following", label: "Following" },
  { id: "blocking", label: "Blocks" },
  { id: "mute", label: "Mutes" },
  { id: "notes", label: "Notes" },
  { id: "user-lists", label: "Lists" },
  { id: "antennas", label: "Antennas" },
  { id: "clips", label: "Clips" },
  { id: "favorites", label: "Favorites" },
];

/** Export (§14): one button per kind; downloads the payload when the
 * backend answers synchronously, otherwise reports the async job (results
 * arrive as an `exportCompleted` notification). 404-gated per kind. */
export function ExportSettings() {
  const auth = useAuth();
  const [results, setResults] = createSignal<Record<string, string>>({});
  const [busy, setBusy] = createSignal<string | null>(null);

  const run = async (kind: ExportKind) => {
    if (busy() !== null) return;
    setBusy(kind);
    try {
      const payload = await exportData(kind);
      if (payload !== undefined && payload !== null) {
        try {
          downloadJson(`keystone-${kind}-export.json`, payload);
          setResults((r) => ({ ...r, [kind]: "Downloaded." }));
        } catch {
          setResults((r) => ({ ...r, [kind]: "Export ready — check your notifications for the completed file." }));
        }
      } else {
        setResults((r) => ({ ...r, [kind]: "Export started. Results arrive as a notification when done." }));
      }
    } catch (err) {
      if (isUnsupportedError(err)) {
        setResults((r) => ({ ...r, [kind]: "Export is not available on this server." }));
      } else {
        setResults((r) => ({ ...r, [kind]: err instanceof Error ? err.message : "Export failed." }));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div class="pagehead">
        <h1>Export</h1>
        <BackToSettings />
      </div>
      <Show when={auth.authReady()} fallback={<LoadingState />}>
        <Show
          when={auth.token()}
          fallback={
            <div class="state">
              <p>You need to sign in to export data.</p>
              <A href="/login">Sign in</A>
            </div>
          }
        >
          <For each={EXPORT_KINDS}>
            {(kind) => (
              <div class="settings-block">
                <h2>{kind.label}</h2>
                <button type="button" disabled={busy() === kind.id} onClick={() => void run(kind.id)}>
                  {busy() === kind.id ? "Exporting…" : `Export ${kind.label.toLowerCase()}`}
                </button>
                <Show when={results()[kind.id]}>
                  <p role="status">{results()[kind.id]}</p>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
}
