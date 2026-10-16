// Embedded link preview card: OpenGraph preview fetched client-side
// (`../api/linkpreview`), degrading to a basic domain card when the page
// offers nothing usable. Always an outbound link, never inert.

import { createResource, Show } from "solid-js";
import { fetchLinkPreview, hostOf } from "../api/linkpreview";

function hideBrokenImage(e: Event): void {
  (e.currentTarget as HTMLImageElement).style.display = "none";
}

export default function LinkCard(props: { url: string }) {
  const [preview] = createResource(props.url, fetchLinkPreview);
  const host = () => hostOf(props.url);
  return (
    <a
      class="linkcard"
      href={props.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open linked page: ${props.url}`}
    >
      <Show when={!preview.loading} fallback={
        <>
          <span class="skel" style={{ width: "100%", height: "120px", "border-radius": "0" }} aria-hidden="true" />
          <div class="linkcard-meta">
            <span class="handle">{host()}</span>
            <span class="skel" style={{ width: "70%", height: "13px", "margin-top": "6px" }} aria-hidden="true" />
          </div>
        </>
      }>
        <Show when={preview()} fallback={
          <div class="linkcard-meta">
            <span class="handle">{host()}</span>
            <span class="linkcard-url">{props.url}</span>
          </div>
        }>
          {(p) => (
            <>
              <Show when={p().image}>
                {(src) => (
                  <img src={src()} alt="" loading="lazy" onError={hideBrokenImage} />
                )}
              </Show>
              <div class="linkcard-meta">
                <span class="linkcard-site">
                  <Show when={p().icon}>
                    {(icon) => (
                      <img
                        class="linkcard-icon"
                        src={icon()}
                        alt=""
                        loading="lazy"
                        onError={hideBrokenImage}
                      />
                    )}
                  </Show>
                  <span class="handle">{p().siteName ?? host()}</span>
                </span>
                <Show when={p().title}>
                  <span class="linkcard-title">{p().title}</span>
                </Show>
                <Show when={p().description}>
                  <span class="handle linkcard-desc">{p().description}</span>
                </Show>
              </div>
            </>
          )}
        </Show>
      </Show>
    </a>
  );
}
