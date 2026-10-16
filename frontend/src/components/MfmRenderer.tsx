import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { JSX } from "solid-js";
import { A } from "@solidjs/router";
import { parse, toString } from "mfm-js";
import type { MfmNode } from "mfm-js";
import { apiCall } from "../api/client";
import type { UserLite } from "../api/types";
import { displayNameOf, headNameOf } from "../api/types";
import { splitRemoteEmojiCodes } from "../api/emoji";
import { DisplayName, EmojiGlyph } from "./EmojiPicker";

// Renders an allow-listed subset of the mfm-js AST as Solid elements.
// Shapes validated against mfm-js 0.27.0 (built/index.d.ts). Unknown nodes
// degrade to plain text via toString — never HTML. No innerHTML anywhere.

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function ExternalLink(props: { url: string; children: JSX.Element }) {
  return (
    <Show when={isSafeUrl(props.url)} fallback={<>{props.children}</>}>
      <a href={props.url} target="_blank" rel="noopener noreferrer">
        {props.children}
      </a>
    </Show>
  );
}

/** Compact display for a bare URL inside a chip: protocol stripped,
// truncated with an ellipsis past 42 characters. The link target is
// always the full URL. */
function displayUrl(url: string): string {
  const bare = url.replace(/^https?:\/\//, "");
  return bare.length > 42 ? `${bare.slice(0, 41)}…` : bare;
}

// Cache of mention acct string -> resolved user (null = not found, so we
// never link to a dead profile and never refetch a miss).
const mentionCache = new Map<string, UserLite | null>();

function MentionLink(props: { acct: string; username: string; host: string | null }) {
  const cached = mentionCache.get(props.acct);
  const [user, setUser] = createSignal<UserLite | null>(cached ?? null);
  const [done, setDone] = createSignal(cached !== undefined);

  onMount(() => {
    if (mentionCache.has(props.acct)) return;
    let alive = true;
    onCleanup(() => {
      alive = false;
    });
    const params: Record<string, unknown> = { username: props.username };
    if (props.host) params.host = props.host;
    apiCall<UserLite>("users/show", params).then(
      (found) => {
        if (!alive) return;
        const kept = found?.id ? found : null;
        mentionCache.set(props.acct, kept);
        if (kept) setUser(kept);
        setDone(true);
      },
      () => {
        if (!alive) return;
        mentionCache.set(props.acct, null);
        setDone(true);
      },
    );
  });

  // mfm-js packs the leading "@" into `acct` already ("@user@host").
  // The chip shows the resolved avatar + display name (the full acct
  // stays on `title` for disambiguation); unresolved mentions keep the
  // verbatim acct text with no link, as before.
  return (
    <Show when={done() && user()} fallback={<span class="mentiontag">{props.acct}</span>}>
      {(resolved) => (
        <A href={`/users/${resolved().id}`} class="mchip-user" title={props.acct}>
          <Show
            when={resolved().avatarUrl}
            fallback={
              <span class="mchip-avatarmissing" aria-hidden="true">
                {displayNameOf(resolved()).slice(0, 1).toUpperCase()}
              </span>
            }
          >
            <img class="mchip-avatar" src={resolved().avatarUrl!} alt="" loading="lazy" />
          </Show>
          <span class="mchip-name"><DisplayName name={headNameOf(resolved())} packed={resolved().emojis} host={resolved().host} /></span>
        </A>
      )}
    </Show>
  );
}

function renderNode(
  node: MfmNode,
  packed?: Record<string, string> | null,
  host?: string | null,
): JSX.Element {
  switch (node.type) {
    case "text":
      // mfm-js never emits `emojiCode` for `:name@host:` (any host dot
      // or not) — remote codes arrive inside text. Split them out here
      // and resolve like any other glyph (packed map, then the remote
      // host's listing); unresolvable codes stay literal text.
      return (
        <>
          <For each={splitRemoteEmojiCodes(node.props.text)}>
            {(part) =>
              part.kind === "remote" ? (
                <EmojiGlyph emoji={part.code} packed={packed} host={host} />
              ) : (
                <>{part.text}</>
              )
            }
          </For>
        </>
      );
    case "plain":
      return (
        <For each={node.children}>{(child) => <>{child.props.text}</>}</For>
      );
    case "bold":
      return (
        <strong>
          <For each={node.children}>{(child) => renderNode(child, packed, host)}</For>
        </strong>
      );
    case "italic":
      return (
        <em>
          <For each={node.children}>{(child) => renderNode(child, packed, host)}</For>
        </em>
      );
    case "strike":
      return (
        <del>
          <For each={node.children}>{(child) => renderNode(child, packed, host)}</For>
        </del>
      );
    case "small":
      return (
        <small>
          <For each={node.children}>{(child) => renderNode(child, packed, host)}</For>
        </small>
      );
    case "inlineCode":
      return <code>{node.props.code}</code>;
    case "blockCode":
      return (
        <pre>
          <code>{node.props.code}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote>
          <For each={node.children}>{(child) => renderNode(child, packed, host)}</For>
        </blockquote>
      );
    case "mention":
      // Chip linking to the resolved profile. The MentionLink resolution
      // is verbatim (no link to dead profiles, no refetch of misses); the
      // chip text stays the verbatim @acct.
      return (
        <span class="mchip">
          <MentionLink acct={node.props.acct} username={node.props.username} host={node.props.host} />
        </span>
      );
    case "hashtag":
      // Tag search lives behind notes/search-by-tag on the Search page.
      // Lone hashtags keep their long-standing rendering — no chip.
      return (
        <A href={`/search?tag=${encodeURIComponent(node.props.hashtag)}`}>
          <span class="hashtag">#{node.props.hashtag}</span>
        </A>
      );
    case "url":
      // Bare URL chip: truncated display text, full URL target, same
      // ExternalLink safety (http(s)-only, unsafe URLs degrade to text).
      return (
        <span class="mchip">
          <ExternalLink url={node.props.url}>
            <>{displayUrl(node.props.url)}</>
          </ExternalLink>
        </span>
      );
    case "link":
      // Labeled-link chip: author-written label kept whole (CSS ellipsis
      // caps it at the chip max-width), same outbound safety as above.
      return (
        <span class="mchip">
          <ExternalLink url={node.props.url}>
            <For each={node.children}>{(child) => renderNode(child, packed, host)}</For>
          </ExternalLink>
        </span>
      );
    case "emojiCode": {
      // The owning note's packed map first (exact intent, remote
      // included), then the global listing; unknown codes (or a
      // not-yet-loaded listing) stay literal — never a fabricated
      // URL. Rendered through EmojiGlyph so a dead packed URL falls
      // through to the live listings instead of a broken image.
      const code = `:${node.props.name}:`;
      return <EmojiGlyph emoji={code} packed={packed} host={host} />;
    }
    case "unicodeEmoji":
      return <span>{node.props.emoji}</span>;
    case "fn":
    case "center":
      // Styling functions have no monochrome equivalent: render children.
      return (
        <span>
          <For each={node.children}>{(child) => renderNode(child, packed, host)}</For>
        </span>
      );
    case "search":
      return <span>{node.props.content}</span>;
    case "mathInline":
    case "mathBlock":
      return <code>{node.props.formula}</code>;
    default:
      return <>{toString(node)}</>;
  }
}

export default function MfmRenderer(props: {
  text: string | null;
  /** Owning object's packed map (`note.emojis`) — exact URLs for the
   * codes in this text, including remote emoji. */
  emojis?: Record<string, string> | null;
  /** Author's host for host-less codes typed on a remote instance. */
  host?: string | null;
}) {
  const nodes = createMemo<MfmNode[]>(() => {
    const text = props.text ?? "";
    if (text.length === 0) return [];
    try {
      return parse(text);
    } catch {
      return [];
    }
  });

  return (
    <Show when={nodes().length > 0} fallback={<>{props.text ?? ""}</>}>
      <For each={nodes()}>{(node) => renderNode(node, props.emojis, props.host)}</For>
    </Show>
  );
}
