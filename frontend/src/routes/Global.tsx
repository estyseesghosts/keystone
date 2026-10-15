import TimelineFeed from "../components/TimelineFeed";

// Probe for `notes/global-timeline`: if the server supports it the feed
// renders normally, otherwise the neutral fallback below is shown. No fake
// data, no polling.
export default function Global() {
  return (
    <TimelineFeed
      endpoint="notes/global-timeline"
      title="Global"
      showComposer={false}
      unsupportedMessage="Global timeline is not available on this server."
    />
  );
}
