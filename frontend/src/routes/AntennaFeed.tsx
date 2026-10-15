import { createSignal, onMount, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { apiCall, isUnsupportedError } from "../api/client";
import type { Antenna } from "../api/types";
import { useAuth } from "../state/auth";
import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";
import TimelineFeed from "../components/TimelineFeed";

export default function AntennaFeed() {
  const params = useParams();
  const auth = useAuth();
  const [antenna, setAntenna] = createSignal<Antenna | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [unsupported, setUnsupported] = createSignal(false);

  const load = async () => {
    const id = params.id ?? "";
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const list = await apiCall<Antenna[]>("antennas/list", {});
      setAntenna(list.find((a) => a.id === id) ?? null);
      if (!list.some((a) => a.id === id)) {
        setError("This antenna no longer exists (deleted or never created here).");
      }
      setUnsupported(false);
    } catch (err) {
      if (isUnsupportedError(err)) setUnsupported(true);
      else setError(err instanceof Error ? err.message : "Could not load the antenna.");
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    if (auth.token()) void load();
    else setLoading(false);
  });

  const id = () => params.id ?? "";

  return (
    <div>
      <Show when={loading()} fallback={
        <Show when={unsupported()} fallback={
          <Show when={error()} fallback={
            <TimelineFeed
              endpoint="antennas/notes"
              title={antenna() ? `Antenna: ${antenna()!.name}` : "Antenna"}
              showComposer={false}
              extraParams={{ antennaId: id() }}
              unsupportedMessage="Antenna feeds are not available on this server."
            />
          }>
            <div class="pagehead"><h1>Antenna</h1></div>
            <ErrorState message={error() ?? "Could not load the antenna."} onRetry={() => void load()} />
          </Show>
        }>
          <div class="pagehead"><h1>Antenna</h1></div>
          <div class="state" role="status">
            <p>Antennas are not available on this server yet.</p>
          </div>
        </Show>
      }>
        <LoadingState label="Loading antenna…" />
      </Show>
    </div>
  );
}
