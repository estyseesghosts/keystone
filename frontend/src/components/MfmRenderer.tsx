import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { JSX } from "solid-js";
import { A } from "@solidjs/router";
import { parse, toString } from "mfm-js";
import type { MfmNode } from "mfm-js";
import { apiCall } from "../api/client";
import type { UserLite } from "../api/types";

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

// Cache of mention acct string -> resolved userId (null = not found, so we
// never link to a dead profile and never refetch a miss).
const mentionCache = new Map<string, string | null>();

function MentionLink(props: { acct: string; username: string; host: string | null }) {
  const cached = mentionCache.get(props.acct);
  const [userId, setUserId] = createSignal<string | null>(cached ?? null);
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
      (user) => {
        if (!alive) return;
        const id = user?.id ?? null;
        mentionCache.set(props.acct, id);
        if (id) setUserId(id);
        setDone(true);
      },
      () => {
        if (!alive) return;
        mentionCache.set(props.acct, null);
        setDone(true);
      },
    );
  });

  return (
    <Show when={done() && userId()} fallback={<span class="mentiontag">@{props.acct}</span>}>
      <A href={`/users/${userId()}`}>@{props.acct}</A>
    </Show>
  );
}

function renderNode(node: MfmNode): JSX.Element {
  switch (node.type) {
    case "text":
      return <>{node.props.text}</>;
    case "plain":
      return (
        <For each={node.children}>{(child) => <>{child.props.text}</>}</For>
      );
    case "bold":
      return (
        <strong>
          <For each={node.children}>{renderNode}</For>
        </strong>
      );
    case "italic":
      return (
        <em>
          <For each={node.children}>{renderNode}</For>
        </em>
      );
    case "strike":
      return (
        <del>
          <For each={node.children}>{renderNode}</For>
        </del>
      );
    case "small":
      return (
        <small>
          <For each={node.children}>{renderNode}</For>
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
          <For each={node.children}>{renderNode}</For>
        </blockquote>
      );
    case "mention":
      return (
        <MentionLink acct={node.props.acct} username={node.props.username} host={node.props.host} />
      );
    case "hashtag":
      // Tag search lives behind notes/search-by-tag on the Search page.
      return (
        <A href={`/search?tag=${encodeURIComponent(node.props.hashtag)}`}>
          <span class="hashtag">#{node.props.hashtag}</span>
        </A>
      );
    case "url":
      return (
        <ExternalLink url={node.props.url}>
          <>{node.props.url}</>
        </ExternalLink>
      );
    case "link":
      return (
        <ExternalLink url={node.props.url}>
          <For each={node.children}>{renderNode}</For>
        </ExternalLink>
      );
    case "emojiCode":
      // No custom-emoji lookup endpoint: show the source code literally.
      return <span>:{node.props.name}:</span>;
    case "unicodeEmoji":
      return <span>{node.props.emoji}</span>;
    case "fn":
    case "center":
      // Styling functions have no monochrome equivalent: render children.
      return (
        <span>
          <For each={node.children}>{renderNode}</For>
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

export default function MfmRenderer(props: { text: string | null }) {
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
      <For each={nodes()}>{renderNode}</For>
    </Show>
  );
}
