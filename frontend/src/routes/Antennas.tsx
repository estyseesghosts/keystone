import { createSignal, For, onMount, Show } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { apiCall, isPermissionError, isUnsupportedError } from "../api/client";
import type { Antenna, AntennaSrc } from "../api/types";
import { useAuth } from "../state/auth";
import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";
import { RowSkeletonList } from "../components/Skeleton";

const SOURCES: { value: AntennaSrc; label: string; hint: string }[] = [
  { value: "home", label: "Home", hint: "Notes from your home timeline" },
  { value: "all", label: "All", hint: "All public notes the server sees" },
  { value: "users", label: "Users", hint: "Only the accounts you list" },
  {
    value: "users_blacklist",
    label: "Users blacklist",
    hint: "Everyone except the accounts you list",
  },
];

function GroupEditor(props: {
  label: string;
  groups: string[][];
  onChange: (groups: string[][]) => void;
}) {
  const setGroup = (gi: number, value: string) => {
    // One text box per AND-group; words are space-separated. The nested
    // array shape is preserved — never flattened on the way to the server.
    const words = value.split(/\s+/).filter((w) => w.length > 0);
    props.onChange(props.groups.map((g, j) => (j === gi ? words : g)));
  };
  return (
    <div class="field">
      <label>{props.label} (each line = words that must ALL appear; lines are OR-ed)</label>
      <For each={props.groups}>
        {(group, gi) => (
          <div class="row">
            <input
              type="text"
              value={group.join(" ")}
              onInput={(e) => setGroup(gi(), e.currentTarget.value)}
              placeholder="keywords…"
              aria-label={`${props.label} group ${gi() + 1}`}
            />
            <button
              type="button"
              disabled={props.groups.length <= 1}
              onClick={() =>
                props.onChange(props.groups.filter((_, j) => j !== gi()))
              }
              aria-label="Remove group"
            >
              ×
            </button>
          </div>
        )}
      </For>
      <button type="button" onClick={() => props.onChange([...props.groups, []])}>
        Add group
      </button>
    </div>
  );
}

export function AntennaForm(props: {
  initial: Antenna | null;
  saving: boolean;
  error: string | null;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const first = () => props.initial;
  const [name, setName] = createSignal(first()?.name ?? "");
  const [src, setSrc] = createSignal<AntennaSrc>(first()?.src ?? "all");
  const [keywords, setKeywords] = createSignal<string[][]>(
    first()?.keywords.length ? first()!.keywords : [[]],
  );
  const [excludeKeywords, setExcludeKeywords] = createSignal<string[][]>(
    first()?.excludeKeywords.length ? first()!.excludeKeywords : [[]],
  );
  const [users, setUsers] = createSignal(first()?.users.join("\n") ?? "");
  const [caseSensitive, setCaseSensitive] = createSignal(first()?.caseSensitive ?? false);
  const [localOnly, setLocalOnly] = createSignal(first()?.localOnly ?? false);
  const [excludeBots, setExcludeBots] = createSignal(first()?.excludeBots ?? false);
  const [withReplies, setWithReplies] = createSignal(first()?.withReplies ?? false);
  const [withFile, setWithFile] = createSignal(first()?.withFile ?? false);

  const cleanGroups = (groups: string[][]) =>
    groups.map((g) => g.filter((w) => w.length > 0)).filter((g) => g.length > 0);

  const valid = () =>
    name().trim().length > 0 &&
    (cleanGroups(keywords()).length > 0 || cleanGroups(excludeKeywords()).length > 0);

  const submit = () => {
    if (!valid()) return;
    props.onSubmit({
      name: name().trim(),
      src: src(),
      keywords: cleanGroups(keywords()),
      excludeKeywords: cleanGroups(excludeKeywords()),
      users: users()
        .split(/[\s,]+/)
        .map((u) => u.trim().replace(/^@/, ""))
        .filter((u) => u.length > 0),
      caseSensitive: caseSensitive(),
      localOnly: localOnly(),
      excludeBots: excludeBots(),
      withReplies: withReplies(),
      withFile: withFile(),
    });
  };

  return (
    <div class="form" style={{ "max-width": "480px" }}>
      <div class="field">
        <label for="antenna-name">Name</label>
        <input
          id="antenna-name"
          type="text"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          maxlength={100}
        />
      </div>
      <div class="field">
        <label for="antenna-src">Source</label>
        <select
          id="antenna-src"
          value={src()}
          onChange={(e) => setSrc(e.currentTarget.value as AntennaSrc)}
        >
          <For each={SOURCES}>{(s) => <option value={s.value}>{s.label} — {s.hint}</option>}</For>
        </select>
      </div>
      <GroupEditor label="Keywords" groups={keywords()} onChange={setKeywords} />
      <GroupEditor label="Excluded keywords" groups={excludeKeywords()} onChange={setExcludeKeywords} />
      <Show when={src() === "users" || src() === "users_blacklist"}>
        <div class="field">
          <label for="antenna-users">Accounts (one per line, @user or @user@host)</label>
          <textarea
            id="antenna-users"
            value={users()}
            onInput={(e) => setUsers(e.currentTarget.value)}
            aria-label="Antenna accounts"
          />
        </div>
      </Show>
      <div class="field">
        <label><input type="checkbox" checked={caseSensitive()} onChange={(e) => setCaseSensitive(e.currentTarget.checked)} /> Case sensitive</label>
        <label><input type="checkbox" checked={localOnly()} onChange={(e) => setLocalOnly(e.currentTarget.checked)} /> Local notes only</label>
        <label><input type="checkbox" checked={excludeBots()} onChange={(e) => setExcludeBots(e.currentTarget.checked)} /> Exclude bots</label>
        <label><input type="checkbox" checked={withReplies()} onChange={(e) => setWithReplies(e.currentTarget.checked)} /> Include replies</label>
        <label><input type="checkbox" checked={withFile()} onChange={(e) => setWithFile(e.currentTarget.checked)} /> Only notes with files</label>
      </div>
      <Show when={props.error}>
        <div class="err" role="alert">{props.error}</div>
      </Show>
      <div class="row">
        <button type="button" class="btn-primary" disabled={props.saving || !valid()} onClick={submit}>
          {props.saving ? "Saving…" : first() ? "Save changes" : "Create antenna"}
        </button>
        <button type="button" onClick={props.onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function Antennas() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [antennas, setAntennas] = createSignal<Antenna[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [unsupported, setUnsupported] = createSignal(false);
  const [denied, setDenied] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [editing, setEditing] = createSignal<Antenna | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [formError, setFormError] = createSignal<string | null>(null);
  const [confirmDelete, setConfirmDelete] = createSignal<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setAntennas(await apiCall<Antenna[]>("antennas/list", {}));
      setUnsupported(false);
      setDenied(false);
    } catch (err) {
      if (isUnsupportedError(err)) {
        // Pinetree has no antenna endpoints yet: say so instead of
        // erroring, and offer nothing that cannot work.
        setUnsupported(true);
      } else if (isPermissionError(err)) {
        setDenied(true);
      } else {
        setError(err instanceof Error ? err.message : "Could not load antennas.");
      }
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    if (auth.token()) void load();
    else setLoading(false);
  });

  const create = async (body: Record<string, unknown>) => {
    setSaving(true);
    setFormError(null);
    try {
      const created = await apiCall<Antenna>("antennas/create", body);
      // Reconcile from the server response; fall back to a reload.
      setAntennas((list) => (list.some((a) => a.id === created.id) ? list : [...list, created]));
      setCreating(false);
      void load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create the antenna.");
    } finally {
      setSaving(false);
    }
  };

  const update = async (body: Record<string, unknown>) => {
    const target = editing();
    if (!target) return;
    setSaving(true);
    setFormError(null);
    try {
      const updated = await apiCall<Antenna>("antennas/update", {
        ...body,
        antennaId: target.id,
      });
      setAntennas((list) => list.map((a) => (a.id === target.id ? updated : a)));
      setEditing(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save the antenna.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (antenna: Antenna) => {
    try {
      await apiCall<undefined>("antennas/delete", { antennaId: antenna.id });
      setAntennas((list) => list.filter((a) => a.id !== antenna.id));
      setConfirmDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the antenna.");
    }
  };

  return (
    <div>
      <div class="pagehead">
        <h1>Antennas</h1>
        <Show when={auth.token() && !unsupported() && !denied() && !creating()}>
          <button type="button" onClick={() => { setEditing(null); setCreating(true); setFormError(null); }}>
            New antenna
          </button>
        </Show>
      </div>
      <Show when={auth.authReady()} fallback={<LoadingState />}>
        <Show when={auth.token()} fallback={
          <div class="state">
            <p>You need to sign in to use antennas.</p>
            <A
              href="/login"
              class="btn-primary"
              style={{
                display: "inline-block",
                padding: "0.4em 0.8em",
                border: "1px solid var(--text)",
                "border-radius": "6px",
                "text-decoration": "none",
              }}
            >
              Sign in
            </A>
          </div>
        }>
          <Show when={unsupported()}>
            <div class="state" role="status">
              <p>Antennas are not available on this server yet.</p>
            </div>
          </Show>
          <Show when={denied()}>
            <div class="state" role="alert">
              <div class="errorbox">
                Your session lacks the antenna permission. Sign out and sign in again to grant it, then retry.
              </div>
              <button type="button" onClick={() => void load()}>Try again</button>
            </div>
          </Show>
          <Show when={!unsupported() && !denied()}>
            <Show when={creating()}>
              <div class="pagehead"><h1>New antenna</h1></div>
              <AntennaForm
                initial={null}
                saving={saving()}
                error={formError()}
                onSubmit={(body) => void create(body)}
                onCancel={() => setCreating(false)}
              />
            </Show>
            <Show when={editing()} keyed>
              {(target) => (
                <>
                  <div class="pagehead"><h1>Edit antenna</h1></div>
                  <AntennaForm
                    initial={target}
                    saving={saving()}
                    error={formError()}
                    onSubmit={(body) => void update(body)}
                    onCancel={() => setEditing(null)}
                  />
                </>
              )}
            </Show>
            <Show when={loading()} fallback={
              <Show when={error()} fallback={
                <Show when={antennas().length > 0} fallback={
                  <div class="state"><p>No antennas yet. Create one to watch for matching notes.</p></div>
                }>
                  <div class="feed">
                    <For each={antennas()}>
                      {(antenna) => (
                        <div class="drivefile">
                          <div style={{ flex: 1 }}>
                            <A href={`/antennas/${antenna.id}`}><strong>{antenna.name}</strong></A>
                            <div class="handle">
                              {antenna.src}
                              {antenna.keywords.length > 0 ? ` · ${antenna.keywords.map((g) => g.join(" ")).join(" / ")}` : ""}
                            </div>
                          </div>
                          <button type="button" onClick={() => navigate(`/antennas/${antenna.id}`)}>Open</button>
                          <button type="button" onClick={() => { setCreating(false); setEditing(antenna); setFormError(null); }}>
                            Edit
                          </button>
                          <Show when={confirmDelete() === antenna.id} fallback={
                            <button type="button" onClick={() => setConfirmDelete(antenna.id)}>Delete</button>
                          }>
                            <button type="button" onClick={() => void remove(antenna)}>Confirm</button>
                            <button type="button" onClick={() => setConfirmDelete(null)}>Cancel</button>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              }>
                <ErrorState message={error() ?? "Could not load antennas."} onRetry={() => void load()} />
              </Show>
            }>
              <RowSkeletonList label="Loading antennas…" />
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
