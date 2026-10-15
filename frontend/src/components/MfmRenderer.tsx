import { createMemo, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { parse, toString } from "mfm-js";
import type { MfmNode } from "mfm-js";

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
      // No user lookup here: render as styled text, not a dead link.
      return <span class="mentiontag">@{node.props.acct}</span>;
    case "hashtag":
      // No note-search endpoint exists: render as styled text, not a link.
      return <span class="hashtag">#{node.props.hashtag}</span>;
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
