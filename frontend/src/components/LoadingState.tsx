export default function LoadingState(props: { label?: string }) {
  return (
    <div class="state" role="status" aria-live="polite">
      <p>{props.label ?? "Loading…"}</p>
    </div>
  );
}
