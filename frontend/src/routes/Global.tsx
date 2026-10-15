import TimelineFeed from "../components/TimelineFeed";

// The backend does not implement `notes/global-timeline` yet (it answers
// 404 UNKNOWN_API_ENDPOINT). This route probes the endpoint: if a future
// server supports it, the feed renders normally; otherwise an honest
// "not supported" panel is shown. No fake data, no polling.
export default function Global() {
  return (
    <TimelineFeed
      endpoint="notes/global-timeline"
      title="Global"
      showComposer={false}
      unsupportedMessage="Global (federated) timeline is not supported by this server yet. It answers 404 for notes/global-timeline. Home and Local work — Global will light up once the backend implements it."
    />
  );
}
