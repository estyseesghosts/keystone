import { Show } from "solid-js";
import { A } from "@solidjs/router";
import { useAuth } from "../state/auth";
import LoadingState from "../components/LoadingState";
import TimelineFeed from "../components/TimelineFeed";

export default function Home() {
  const auth = useAuth();
  return (
    <Show when={auth.authReady()} fallback={<LoadingState />}>
      <Show when={auth.token()} fallback={
        <div class="state">
          <p>You need to sign in to see your home timeline.</p>
          <A href="/login"><button type="button">Sign in</button></A>
        </div>
      }>
        <TimelineFeed endpoint="notes/timeline" title="Home" showComposer />
      </Show>
    </Show>
  );
}
