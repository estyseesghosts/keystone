import TimelineFeed from "../components/TimelineFeed";

export default function Local() {
  return <TimelineFeed endpoint="notes/local-timeline" title="Local" showComposer />;
}
