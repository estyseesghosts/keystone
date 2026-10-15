import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { useAuth } from "../state/auth";
import { displayNameOf, handleOf } from "../api/types";

export default function Layout(props: { children: JSX.Element }) {
  const auth = useAuth();
  const navigate = useNavigate();

  const signout = () => {
    auth.signout();
    navigate("/login");
  };

  return (
    <div class="layout">
      <nav class="sitenav" aria-label="Main">
        <A class="brand" href="/">Keystone</A>
        <A class="navlink" href="/" end activeClass="active">Home</A>
        <A class="navlink" href="/local" activeClass="active">Local</A>
        <A class="navlink" href="/global" activeClass="active">Global</A>
        <Show when={auth.me()}>
          <A class="navlink" href="/notifications" activeClass="active">Notifications</A>
        </Show>
        <div class="navspacer" />
        <div class="navuser">
          <Show
            when={auth.me()}
            fallback={<A class="navlink" href="/login" activeClass="active">Sign in</A>}
          >
            <span class="who">{handleOf(auth.me()!)}</span>
            <span class="who">{displayNameOf(auth.me()!)}</span>
            <button type="button" onClick={signout}>Sign out</button>
          </Show>
        </div>
      </nav>
      <main class="maincol">{props.children}</main>
    </div>
  );
}
