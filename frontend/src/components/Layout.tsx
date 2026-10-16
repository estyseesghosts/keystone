import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { A } from "@solidjs/router";
import { useAuth } from "../state/auth";
import { usePostbox } from "../state/postbox";
import AccountCard from "./AccountCard";
import FloatingComposer from "./FloatingComposer";
import {
  AntennaIcon,
  BellIcon,
  DriveIcon,
  GlobalIcon,
  HomeIcon,
  LocalIcon,
  LoginIcon,
  PencilIcon,
  SearchIcon,
} from "./icons";

function NavItem(props: {
  href: string;
  label: string;
  icon: JSX.Element;
  end?: boolean;
}) {
  return (
    <A
      class="navlink"
      href={props.href}
      end={props.end}
      activeClass="active"
      title={props.label}
      aria-label={props.label}
    >
      <span class="navicon">{props.icon}</span>
      <span class="navlabel">{props.label}</span>
    </A>
  );
}

export default function Layout(props: { children: JSX.Element }) {
  const auth = useAuth();
  const postbox = usePostbox();

  return (
    <div class="layout">
      <div class="mobile-account">
        <A class="mobile-brand" href="/">Keystone</A>
        <div class="mobile-account-spacer" />
        <Show
          when={auth.me()}
          fallback={<A class="mobile-signin" href="/login">Sign in</A>}
        >
          <AccountCard />
        </Show>
      </div>
      <nav
        class="sitenav"
        aria-label="Main"
      >
        <A class="brand" href="/" title="Keystone" aria-label="Keystone home">
          <span class="brand-full">Keystone</span>
          <span class="brand-short" aria-hidden="true">K</span>
        </A>
        <NavItem href="/" label="Home" icon={<HomeIcon />} end />
        <NavItem href="/local" label="Local" icon={<LocalIcon />} />
        <NavItem href="/global" label="Global" icon={<GlobalIcon />} />
        <NavItem href="/search" label="Search" icon={<SearchIcon />} />
        <Show when={auth.me()}>
          <NavItem href="/drive" label="Drive" icon={<DriveIcon />} />
          <NavItem href="/antennas" label="Antennas" icon={<AntennaIcon />} />
        </Show>
        <Show when={auth.me()}>
          <NavItem
            href="/notifications"
            label="Notifications"
            icon={<BellIcon />}
          />
        </Show>
        <Show when={auth.me()}>
          <button
            type="button"
            class="navlink navbutton"
            onClick={() => postbox.open()}
            title="Write a post"
            aria-label="Write a post"
          >
            <span class="navicon">
              <PencilIcon />
            </span>
            <span class="navlabel">Post</span>
          </button>
        </Show>
        <div class="navspacer" />
        <div class="navuser">
          <Show
            when={auth.me()}
            fallback={
              <NavItem href="/login" label="Sign in" icon={<LoginIcon />} />
            }
          >
            <AccountCard />
          </Show>
        </div>
      </nav>
      <main class="maincol">{props.children}</main>
      <FloatingComposer />
    </div>
  );
}
