import { Show } from "solid-js";
import { A } from "@solidjs/router";
import { useAuth } from "../state/auth";
import LoadingState from "../components/LoadingState";
import DriveBrowser from "../components/DriveBrowser";

export default function Drive() {
  const auth = useAuth();
  return (
    <div>
      <div class="pagehead"><h1>Drive</h1></div>
      <Show when={auth.authReady()} fallback={<LoadingState />}>
        <Show when={auth.token()} fallback={
          <div class="state">
            <p>You need to sign in to use your Drive.</p>
            <A
              href="/login"
              class="btn-primary"
              style={{
                display: "inline-block",
                padding: "6px 12px",
                border: "1px solid var(--text)",
                "border-radius": "6px",
                "text-decoration": "none",
              }}
            >
              Sign in
            </A>
          </div>
        }>
          <DriveBrowser />
        </Show>
      </Show>
    </div>
  );
}
