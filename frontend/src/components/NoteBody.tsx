import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { parse } from "mfm-js";
import type { MfmNode } from "mfm-js";
import type { DriveFile, Note } from "../api/types";
import { displayNameOf, handleOf, hasRealDisplayName, headNameOf } from "../api/types";
import { apiCall } from "../api/client";
import TranslatableText from "./TranslatableText";
import TagBubble from "./TagBubble";
import { parseTagBlocks } from "../api/tags";
import { formatTime } from "./time";
import { DisplayName } from "./EmojiPicker";
import LinkCard from "./LinkCard";
import ProfileCardLoader, { parseProfileUrl } from "./ProfileCard";
import type { ProfileRef } from "./ProfileCard";
import {
  getQuoteTarget,
  parseTextualQuotes,
  registerSeenNote,
  resolveQuoteUri,
  statusLabelFor,
  structuredUrisOf,
  urisMatch,
} from "../api/quote";

function Avatar(props: { url: string | null; name: string }) {
  return (
    <Show
      when={props.url}
      fallback={<div class="avatar-fallback" aria-hidden="true">{props.name.slice(0, 1).toUpperCase()}</div>}
    >
      <img class="avatar" src={props.url!} alt="" loading="lazy" />
    </Show>
  );
}

/** Quoted-note header: avatar + name + handle · time, with the tag-block
 * bubble on the right from the quoted note's full original text. */
function QuoteHead(props: { note: Note }) {
  const tags = createMemo(() => parseTagBlocks(props.note.text ?? ""));
  return (
    <div class="renote-head">
      <Avatar url={props.note.user.avatarUrl} name={displayNameOf(props.note.user)} />
      <span class="name"><DisplayName name={headNameOf(props.note.user)} packed={props.note.user.emojis} host={props.note.user.host} /></span>
      <Show
        when={hasRealDisplayName(props.note.user)}
        fallback={<span class="handle">{formatTime(props.note.createdAt)}</span>}
      >
        <span class="handle">{handleOf(props.note.user)} · {formatTime(props.note.createdAt)}</span>
      </Show>
      <span class="spacer" aria-hidden="true" />
      <Show when={tags().blocks.length > 0}>
        <TagBubble tags={tags().blockedTags} />
      </Show>
    </div>
  );
}

function FileLink(props: { file: DriveFile }) {
  return (
    <a class="mediafile" href={props.file.url} target="_blank" rel="noopener noreferrer">
      {props.file.name}
    </a>
  );
}

function MediaItem(props: { file: DriveFile }) {
  const [revealed, setRevealed] = createSignal(!props.file.isSensitive);
  const [failed, setFailed] = createSignal(false);
  const isImage = () => props.file.type.startsWith("image/");
  const isVideo = () => props.file.type.startsWith("video/");
  const isAudio = () => props.file.type.startsWith("audio/");
  return (
    <Show
      when={revealed()}
      fallback={
        <button type="button" class="mediafile" onClick={() => setRevealed(true)}>
          Show sensitive media ({props.file.name})
        </button>
      }
    >
      <Show when={failed()} fallback={
        <Show
          when={isImage()}
          fallback={
            <Show
              when={isVideo()}
              fallback={
                <Show when={isAudio()} fallback={<FileLink file={props.file} />}>
                  <audio
                    controls
                    preload="metadata"
                    src={props.file.url}
                    onError={() => setFailed(true)}
                  >
                    Your browser cannot play this audio ({props.file.name})
                  </audio>
                </Show>
              }
            >
              <video
                controls
                preload="metadata"
                src={props.file.url}
                onError={() => setFailed(true)}
              >
                Your browser cannot play this video ({props.file.name})
              </video>
            </Show>
          }
        >
          <img
            src={props.file.thumbnailUrl ?? props.file.url}
            alt={props.file.name}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        </Show>
      }>
        <FileLink file={props.file} />
      </Show>
    </Show>
  );
}

function PollBlock(props: { note: Note; canVote: boolean; onChanged?: () => void }) {
  const [voting, setVoting] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const poll = () => props.note.poll!;
  const total = () => poll().choices.reduce((sum, c) => sum + c.votes, 0);
  const voted = () => poll().choices.some((c) => c.isVoted);

  const vote = async (choice: number) => {
    if (!props.canVote || voting() !== null || voted()) return;
    setVoting(choice);
    setError(null);
    try {
      await apiCall<undefined>("notes/polls/vote", {
        noteId: props.note.id,
        choice,
      });
      props.onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vote failed.");
    } finally {
      setVoting(null);
    }
  };

  return (
    <div class="poll">
      <For each={poll().choices}>
        {(choice, i) => (
          <button
            type="button"
            class="pollopt"
            disabled={!props.canVote || voting() !== null || voted()}
            onClick={() => void vote(i())}
            aria-label={voted() || !props.canVote ? `${choice.text}: ${choice.votes} votes` : `Vote for ${choice.text}`}
          >
            <span>{choice.isVoted ? "✓ " : ""}<DisplayName name={choice.text} packed={props.note.emojis} host={props.note.user.host} /></span>
            <span class="handle">{choice.votes}</span>
          </button>
        )}
      </For>
      <div class="handle">
        {total()} votes{props.note.poll!.multiple ? " · multiple choice" : ""}
        {props.note.poll!.expiresAt ? ` · ends ${new Date(props.note.poll!.expiresAt).toLocaleString()}` : ""}
      </div>
      <Show when={error()}>
        <div class="err" role="alert">{error()}</div>
      </Show>
    </div>
  );
}

export interface NoteBodyProps {
  note: Note;
  canVote: boolean;
  onChanged?: () => void;
  /** Embed depth: top-level notes render at 0, quoted notes at 1.
   * Deeper nesting collapses to a link so embeds can never recurse. */
  depth?: number;
  /** Fold long text on timelines (default true). Depth > 0 never folds —
   * the 4-line clamp already governs quotes. */
  foldText?: boolean;
}

/** The single rendering path for note content: CW gate, text, media, poll,
 * and quote cards. Both top-level cards and embedded quotes go through
 * here, so an embedded note's content warning and sensitive-media controls
 * always apply — hiding the outer note is never the only protection.
 *
 * Quotes render from one normalized target (`getQuoteTarget`): a packed
 * `renote` embeds directly, a URI-only target (textual `RE:` fallback or
 * Pinetree `quoteTargetUri`) resolves through `ap/show`, and anything
 * unresolvable keeps the original text plus a stable unavailable state.
 * Authorization status is a display label only and never gates rendering. */
export default function NoteBody(props: NoteBodyProps) {
  const [cwOpen, setCwOpen] = createSignal(false);
  const depth = () => props.depth ?? 0;
  const hasCw = () => (props.note.cw?.length ?? 0) > 0;
  const visible = () => !hasCw() || cwOpen();

  // Strip layout only for 2+ images/videos on a top-level note: a lone
  // image or video keeps the fit-to-width `.media` rules and is never
  // horizontally scrollable, and quoted notes never use the interactive
  // strip — their media renders flush edge-to-edge instead (see
  // `.media-quote` in global.css).
  const isStrip = () =>
    depth() === 0 &&
    props.note.files.filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/"),
    ).length > 1;
  const mediaClass = () =>
    depth() === 0 ? (isStrip() ? "media media-strip" : "media") : "media media-quote";

  // Single source of truth for quote-card rendering at this level.
  const quote = createMemo(() => getQuoteTarget(props.note));
  const statusLabel = createMemo(() =>
    statusLabelFor(quote()?.authorizationStatus),
  );

  // Notes rendered here become reuse candidates for textual fallbacks,
  // so a quote of an already-loaded note needs no extra lookup.
  createEffect(() => {
    const current = props.note;
    registerSeenNote(current);
    if (current.renote) registerSeenNote(current.renote);
  });

  // The URI to resolve at this level: a textual fallback, or a structured
  // URI-only target with no packed note and no unavailability flag. Never
  // fetched inside an embed (no recursive explosion), never fetched when
  // the target is flagged unavailable (never chase protected URIs).
  const pendingUri = createMemo(() => {
    if (depth() !== 0) return null;
    const target = quote();
    if (!target || !target.uri || target.targetUnavailable) return null;
    if (target.source === "structured" && (props.note.renote || target.noteId)) {
      return null;
    }
    return target.uri;
  });

  const [resolved] = createResource(pendingUri, async (uri) => {
    if (!uri) return null;
    return resolveQuoteUri(uri);
  });

  // The embedded note when a card renders: the packed renote, or a URI
  // that resolved to a Note. Anything else falls through to the resolving
  // indicator or the unavailable fallback below.
  const embeddedNote = createMemo((): Note | null => {
    if (!quote() || depth() !== 0) return null;
    if (props.note.renote) return props.note.renote;
    return resolved() ?? null;
  });

  const showResolving = createMemo(
    () => depth() === 0 && !!pendingUri() && resolved.loading,
  );

  // Stable fallback for a structured relationship with no viewable target:
  // a renoteId whose note is deleted/invisible, a flagged-unavailable
  // target, or a URI that finished resolving without a Note. Textual
  // fallbacks never reach here — a failed lookup keeps the original `RE:`
  // text as the fallback.
  const showUnavailable = createMemo(() => {
    if (depth() !== 0) return false;
    const target = quote();
    if (!target || target.source !== "structured") return false;
    if (props.note.renote || embeddedNote() || showResolving()) return false;
    if (target.targetUnavailable || target.noteId) return true;
    // URI-only: show the fallback only after resolution finished with no
    // Note (while loading, the resolving indicator shows instead).
    return (
      !!target.uri && !!pendingUri() && !resolved.loading && resolved() === null
    );
  });
  const unavailableNoteId = createMemo(() => quote()?.noteId ?? null);

  // View transformation only: hide a leading `RE:` marker, a terminal
  // `RE:` suffix, or both — but only when the marker's card actually
  // renders. A textual-fallback marker hides when its own resolved card
  // shows; a marker duplicating the structured target hides when that
  // card (or its stable unavailable fallback) renders. Persisted text is
  // never mutated; a failed lookup keeps the marker visible.
  //
  // Declared before cardUrls/visibleText: memos compute eagerly on
  // creation, so a later memo cannot read one declared below it (TDZ).
  const textMarkers = createMemo(() => parseTextualQuotes(props.note.text));
  const coveredMarkers = createMemo(() => {
    const target = quote();
    if (!target || depth() !== 0) return [];
    return textMarkers().filter((m) => {
      if (target.source === "textual-fallback") {
        return !!target.uri && urisMatch(m.uri, target.uri) && !!embeddedNote();
      }
      return (
        structuredUrisOf(props.note).some((uri) => urisMatch(uri, m.uri)) &&
        (!!embeddedNote() || showUnavailable())
      );
    });
  });
  const strippedUris = createMemo(() => coveredMarkers().map((m) => m.uri));
  // Embedded cards from bare URLs in the text: profile URLs unfurl into
  // profile cards, the first other URL gets the link card. A URL the
  // quote card already covers never doubles up: the quote target's own
  // URI, or any URL on a stripped `RE:` marker line (prefix or suffix).
  // A marker that failed to resolve keeps its text AND its card — the
  // fallback link is the only way to reach the target.
  const cardUrls = createMemo((): string[] => {
    const text = props.note.text;
    if (!text) return [];
    let nodes: MfmNode[];
    try {
      nodes = parse(text);
    } catch {
      return [];
    }
    const quoteUri = quote()?.uri;
    const stripped = strippedUris();
    const urls: string[] = [];
    for (const node of nodes) {
      if (node.type !== "url") continue;
      const url = node.props.url;
      if (typeof url !== "string" || urls.includes(url)) continue;
      if (quoteUri && urisMatch(url, quoteUri)) continue;
      if (stripped.some((u) => urisMatch(url, u))) continue;
      urls.push(url);
    }
    return urls;
  });

  const profileRefs = createMemo((): ProfileRef[] => {
    const refs: ProfileRef[] = [];
    for (const url of cardUrls()) {
      const ref = parseProfileUrl(url);
      if (ref) refs.push(ref);
    }
    return refs;
  });

  const linkUrl = createMemo((): string | null => {
    for (const url of cardUrls()) {
      if (!parseProfileUrl(url)) return url;
    }
    return null;
  });

  // Compact link for quotes nested inside an embed: the embed never fetches
  // or expands, it only links out. Textual fallbacks need no extra link —
  // the embedded text already carries the URL as a normal link.
  const compactHref = createMemo((): string | null => {
    const target = quote();
    if (!target) return null;
    if (props.note.renote) return `/notes/${props.note.renote.id}`;
    if (target.source !== "structured") return null;
    if (target.noteId) return `/notes/${target.noteId}`;
    if (target.targetUnavailable || !target.uri) return null;
    return target.uri;
  });
  const compactExternal = createMemo(() => {
    const href = compactHref();
    return !!href && /^https?:\/\//.test(href);
  });

  const visibleText = createMemo(() => {
    const text = props.note.text;
    if (text == null || depth() !== 0) return text;
    if (!quote()) return text;
    const covered = coveredMarkers();
    if (covered.length === 0) return text;
    let out = text;
    const sorted = [...covered].sort((a, b) => b.start - a.start);
    for (const m of sorted) out = out.slice(0, m.start) + out.slice(m.end);
    // A stripped leading marker sat on its own line; a stripped suffix
    // ran to the end — trim only the edge(s) stripping touched.
    if (covered.some((m) => m.start === 0)) out = out.replace(/^[ \t\r\n]+/, "");
    if (covered.some((m) => m.end === text.length)) out = out.replace(/[ \t\r\n]+$/, "");
    return out;
  });

  // Order of operations per note: full text → RE-suffix suppression (above)
  // → tag-block prune (here) → fold of the displayed text (TranslatableText
  // below). Pruned-block ranges never reach the renderer, so a bubble tag
  // and an inline chip can never double-cover one tag.
  const tagParse = createMemo(() => parseTagBlocks(visibleText() ?? ""));
  const prunedText = createMemo(() => tagParse().prunedText);
  const folds = () => props.foldText !== false && depth() === 0;

  return (
    <>
      <Show when={hasCw()}>
        <div class="cwbox">
          <p><DisplayName name={props.note.cw ?? ""} packed={props.note.emojis} host={props.note.user.host} /></p>
          <button type="button" onClick={() => setCwOpen((v) => !v)}>
            {cwOpen() ? "Hide" : "Show"}
          </button>
        </div>
      </Show>

      <Show when={visible()}>
        <div class="notebody">
          <TranslatableText
            noteId={props.note.id}
            text={prunedText()}
            visible={visible()}
            foldText={folds()}
            emojis={props.note.emojis}
            host={props.note.user.host}
          />
        </div>
        <Show when={props.note.files.length > 0}>
          <div class={mediaClass()}>
            <For each={props.note.files}>{(file) => <MediaItem file={file} />}</For>
          </div>
        </Show>
        <Show when={props.note.poll}>
          <PollBlock note={props.note} canVote={props.canVote} onChanged={props.onChanged} />
        </Show>
        <For each={profileRefs()}>
          {(profile) => <ProfileCardLoader profile={profile} />}
        </For>
        <Show when={linkUrl()}>
          {(url) => <LinkCard url={url()} />}
        </Show>
        <Show when={quote()}>
          <Show when={depth() === 0} fallback={
            <Show when={compactHref()} fallback={
              <Show when={quote()?.targetUnavailable}>
                <div class="renote-foot handle">Quoted note is unavailable.</div>
              </Show>
            }>
              {(href) => (
                <div class="renote-foot">
                  <Show when={compactExternal()} fallback={
                    <A href={href()}>Open quoted note</A>
                  }>
                    <a href={href()} target="_blank" rel="noopener noreferrer">
                      Open quoted note
                    </a>
                  </Show>
                </div>
              )}
            </Show>
          }>
            <Show when={embeddedNote()}>
              {(embedded) => (
                <div class="renote-embed">
                  <QuoteHead note={embedded()} />
                  <Show when={statusLabel()}>
                    {(label) => <div class="handle quote-status">{label()}</div>}
                  </Show>
                  <NoteBody
                    note={embedded()}
                    canVote={props.canVote}
                    onChanged={props.onChanged}
                    depth={depth() + 1}
                  />
                  <div class="renote-foot">
                    <A href={`/notes/${embedded().id}`}>Open quoted note</A>
                  </div>
                </div>
              )}
            </Show>
            <Show when={showResolving()}>
              <div class="handle quote-resolving" role="status">Resolving quote…</div>
            </Show>
            <Show when={showUnavailable()}>
              <div class="renote-embed quote-unavailable">
                <Show when={statusLabel()}>
                  {(label) => <div class="handle quote-status">{label()}</div>}
                </Show>
                <div class="handle">Quoted note is unavailable.</div>
                <Show when={unavailableNoteId()}>
                  {(id) => (
                    <div class="renote-foot">
                      <A href={`/notes/${id()}`}>Open quoted note</A>
                    </div>
                  )}
                </Show>
              </div>
            </Show>
          </Show>
        </Show>
      </Show>
    </>
  );
}

export { Avatar };
