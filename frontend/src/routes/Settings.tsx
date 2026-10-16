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

import { For, Show, createSignal, onMount } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { useAuth } from "../state/auth";
import { apiCall, isUnsupportedError } from "../api/client";
import { TEXT_SCALE_MAX, TEXT_SCALE_MIN, useAppearance } from "../state/appearance";
import type { ColorMode } from "../state/appearance";
import { useEmojiPrefs } from "../state/emojiPrefs";
import { DEFAULT_LIKE_EMOJI } from "../api/emoji";
import { DisplayName, EmojiGlyph } from "../components/EmojiPicker";
import { BACKEND_URL } from "../api/backend";
import { displayNameOf, handleOf, hasRealDisplayName, headNameOf } from "../api/types";
import type { MeDetailed, UserLite } from "../api/types";
import {
  listBlocks,
  listMutes,
  listRenoteMutes,
  unblockUser,
  unmuteRenotes,
  unmuteUser,
} from "../api/mutes";
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
    hint: "Blocked, muted, and repost-muted accounts",
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
              <DisplayName name={headNameOf(user())} packed={user().emojis} />
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

/** Mutes and blocks (§§0, 12): blocked, muted, and repost-muted accounts
 * with unblock/unmute. 404-gated per list — unsupported backends render an
 * honest unavailable state instead of an error. */
export function MutesSettings() {
  const auth = useAuth();
  const [blocks, setBlocks] = createSignal<UserLite[]>([]);
  const [mutes, setMutes] = createSignal<UserLite[]>([]);
  const [renoteMutes, setRenoteMutes] = createSignal<UserLite[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [unsupported, setUnsupported] = createSignal<string[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const load = async () => {
    setLoading(true);
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
    setLoading(false);
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
