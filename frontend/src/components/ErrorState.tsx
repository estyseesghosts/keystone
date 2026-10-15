import { Show } from "solid-js";

export default function ErrorState(props: { message: string; onRetry?: () => void }) {
  return (
    <div class="state" role="alert">
      <div class="errorbox">{props.message}</div>
      <Show when={props.onRetry}>
        <button type="button" onClick={() => props.onRetry?.()}>
          Try again
        </button>
      </Show>
    </div>
  );
}
