// Notification rows in the Keystone note language (§12): avatar +
// name/handle/time head line, sentence-case description, content preview,
// Open-note link. No two-column layout, no uppercase kind badges — a
// notification reads like a compact note.

import { For, Show } from "solid-js";
import { A } from "@solidjs/router";
import type { GroupedNotificationItem, NotificationItem, UserLite } from "../api/types";
import { displayNameOf, handleOf, hasRealDisplayName, headNameOf } from "../api/types";
import { DisplayName, EmojiGlyph } from "./EmojiPicker";
import MfmRenderer from "./MfmRenderer";
import { formatTime } from "./time";

function titleCase(type: string): string {
  const words = type
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return type;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Sentence-case description of what happened ("followed you",
 * "reacted to your note"). Unknown types fall back to title case. */
export function describeOf(type: string): string {
  switch (type) {
    case "follow":
      return "followed you";
    case "mention":
      return "mentioned you";
    case "reply":
      return "replied to you";
    case "renote":
      return "reposted your note";
    case "quote":
      return "quoted your note";
    case "reaction":
      return "reacted to your note";
    case "pollVote":
      return "voted in your poll";
    case "pollEnded":
      return "your poll ended";
    case "receiveFollowRequest":
      return "requested to follow you";
    case "followRequestAccepted":
      return "accepted your follow request";
    case "followRequestRejected":
      return "declined your follow request";
    case "login":
      return "signed in";
    case "createToken":
      return "created an app token";
    case "scheduledNotePosted":
      return "posted a scheduled note";
    case "scheduledNoteError":
      return "a scheduled note failed to post";
    case "note":
      return "updated a note";
    case "roleAssigned":
      return "was assigned a role";
    case "achievementEarned":
      return "earned an achievement";
    case "test":
      return "sent a test notification";
    case "exportCompleted":
      return "your export is ready";
    case "app":
      return "sent an app notification";
    default:
      return titleCase(type);
  }
}

function NotifAvatar(props: { user: UserLite | null; label: string }) {
  const inner = () => (
    <Show
      when={props.user?.avatarUrl}
      fallback={
        <div class="avatar-fallback" aria-hidden="true">
          {props.label.slice(0, 1).toUpperCase()}
        </div>
      }
    >
      <img class="avatar" src={props.user!.avatarUrl!} alt="" loading="lazy" />
    </Show>
  );
  return (
    <Show
      when={props.user}
      fallback={inner()}
    >
      <A
        class="avatarlink"
        href={`/users/${props.user!.id}`}
        aria-label={`Open profile of ${props.label}`}
      >
        {inner()}
      </A>
    </Show>
  );
}

export function NotificationRow(props: { item: NotificationItem }) {
  const n = () => props.item;
  const userLabel = () => (n().user ? displayNameOf(n().user!) : "Unknown user");
  return (
    <div class="notif">
      <NotifAvatar user={n().user} label={userLabel()} />
      <div class="notif-main">
        <div class="notif-head">
          <Show
            when={n().user}
            fallback={<span class="name">Unknown user</span>}
          >
            <A class="namelink" href={`/users/${n().user!.id}`}>
              <span class="name">
                <DisplayName name={headNameOf(n().user!)} packed={n().user!.emojis} host={n().user!.host} />
              </span>
              <Show when={hasRealDisplayName(n().user!)}>
                <span class="handle">{handleOf(n().user!)}</span>
              </Show>
            </A>
          </Show>
          <span class="time">{formatTime(n().createdAt)}</span>
        </div>
        <div class="notif-desc">
          {describeOf(n().type)}
          <Show when={n().reaction}>
            {(reaction) => (
              <>
                {" "}<EmojiGlyph emoji={reaction()} packed={n().note?.reactionEmojis} host={n().note?.user.host} />
              </>
            )}
          </Show>
        </div>
        <Show when={n().note?.text} fallback={
          <Show when={n().note && n().note!.renoteId}>
            <div class="handle">Reposted a note</div>
          </Show>
        }>
          <div class="notebody">
            <MfmRenderer text={n().note!.text} emojis={n().note!.emojis} host={n().note!.user.host} />
          </div>
        </Show>
        <Show when={n().note}>
          <A class="action" href={`/notes/${n().note!.id}`}>Open note</A>
        </Show>
      </div>
    </div>
  );
}

export function GroupedNotificationRow(props: { item: GroupedNotificationItem }) {
  const n = () => props.item;
  const base = () => n().type.replace(/:grouped$/, "");
  const people = () => n().users ?? [];
  const personCount = () =>
    n().type === "renote:grouped"
      ? (n().userIds ?? people().map((u) => u.id)).length
      : Math.max(people().length, n().reactions?.length ?? 0, 1);
  const countNoun = () =>
    personCount() === 1 ? "One person" : `${personCount()} people`;
  return (
    <div class="notif">
      <NotifAvatar
        user={people()[0] ?? n().user ?? null}
        label={people()[0] ? displayNameOf(people()[0]) : "Notifications"}
      />
      <div class="notif-main">
        <div class="notif-head">
          <Show when={people().length > 0} fallback={<span class="name">Notifications</span>}>
            <span class="name">
              <For each={people().slice(0, 3)}>
                {(u, i) => (
                  <span>
                    {i() > 0 ? ", " : ""}
                    <A class="namelink" href={`/users/${u.id}`}>
                      <DisplayName name={headNameOf(u)} packed={u.emojis} host={u.host} />
                    </A>
                  </span>
                )}
              </For>
              <Show when={people().length > 3}>
                <span class="handle"> and {people().length - 3} others</span>
              </Show>
            </span>
          </Show>
          <span class="time">{formatTime(n().createdAt)}</span>
        </div>
        <div class="notif-desc">
          <Show
            when={n().type === "reaction:grouped" && n().reactions}
            fallback={`${countNoun()} ${describeOf(base())}`}
          >
            {countNoun()} reacted to your note{" "}
            <For each={[...new Set((n().reactions ?? []).map((r) => r.reaction))].slice(0, 5)}>
              {(emoji) => (
                <><EmojiGlyph emoji={emoji} packed={n().note?.reactionEmojis} host={n().note?.user.host} />{" "}</>
              )}
            </For>
          </Show>
        </div>
        <Show when={n().note}>
          <A class="action" href={`/notes/${n().note!.id}`}>Open note</A>
        </Show>
      </div>
    </div>
  );
}
