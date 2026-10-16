// Live-connection status badge. Renders nothing when streaming is disabled
// (pinetree mode) or while the channel subscription is settling into its
// first ack; otherwise a short grey status phrase. Manual refresh + paging
// always keep working regardless of what this shows.

import { Show } from "solid-js";
import { useStreamState } from "../api/stream";
import type { ChannelStatus } from "../api/stream";

export default function StreamBadge(props: {
  channelStatus: () => ChannelStatus;
}) {
  const stream = useStreamState();

  const text = (): string | null => {
    const channel = props.channelStatus();
    if (channel === "disabled") return null;
    if (channel === "unavailable") return "Live updates unavailable";
    switch (stream.status()) {
      case "live":
        return channel === "subscribed" ? "Live" : "Connecting…";
      case "connecting":
        return "Connecting…";
      case "reconnecting":
        return `Reconnecting… (attempt ${stream.attempt()})`;
      case "error":
        return "Live updates unavailable";
      case "disabled":
        return null;
    }
  };

  return (
    <Show when={text()}>
      <span class="streamstate" role="status" title={stream.lastError() ?? undefined}>
        {text()}
      </span>
    </Show>
  );
}
