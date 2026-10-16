// Infinite-scroll sentinel: when this div scrolls near the viewport the
// next page loads automatically — no "Load older" button. The generous
// rootMargin preloads the next page before the user reaches the bottom so
// the scroll never visibly stalls; a short first page keeps triggering
// until the view scrolls or the server is exhausted. Guards live in the
// caller's `canLoad` (mirroring that loader's busy/loading/exhausted
// checks) so failed/empty/unsupported states never spin. Like the Drive
// house pattern, there is deliberately no error guard: a failed page
// keeps its "Try again" path with the remembered cursor, and the
// observer only refires on intersection changes, never in a loop.

import { onCleanup, onMount } from "solid-js";

export default function InfiniteSentinel(props: {
  canLoad: () => boolean;
  onLoad: () => void;
}) {
  let sentinel: HTMLDivElement | undefined;
  onMount(() => {
    const target = sentinel;
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (!props.canLoad()) return;
        props.onLoad();
      },
      { rootMargin: "800px" },
    );
    observer.observe(target);
    onCleanup(() => observer.disconnect());
  });
  return <div ref={sentinel} aria-hidden="true" />;
}
