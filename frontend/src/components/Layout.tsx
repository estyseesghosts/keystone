import { createSignal, Show } from "solid-js";
import type { JSX } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { useAuth } from "../state/auth";
import { displayNameOf, handleOf } from "../api/types";
import {
  AntennaIcon,
  BellIcon,
  CollapseIcon,
  DriveIcon,
  GlobalIcon,
  HomeIcon,
  LocalIcon,
  LoginIcon,
  LogoutIcon,
  SearchIcon,
} from "./icons";

const COLLAPSE_KEY = "keystone_nav_collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

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
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = createSignal(readCollapsed());

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // Storage unavailable: collapse lasts for this session only.
      }
      return next;
    });
  };

  const signout = () => {
    auth.signout();
    navigate("/login");
  };

  return (
    <div class="layout">
      <div class="mobile-account">
        <A class="mobile-brand" href="/">Keystone</A>
        <div class="mobile-account-spacer" />
        <Show
          when={auth.me()}
          fallback={<A class="mobile-signin" href="/login">Sign in</A>}
        >
          <span class="who">{handleOf(auth.me()!)}</span>
          <button type="button" onClick={signout}>Sign out</button>
        </Show>
      </div>
      <nav
        class="sitenav"
        classList={{ collapsed: collapsed() }}
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
        <div class="navspacer" />
        <button
          type="button"
          class="navlink navbutton collapse-toggle"
          onClick={toggleCollapsed}
          title={collapsed() ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed() ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed()}
        >
          <span class="navicon">
            <CollapseIcon expanded={!collapsed()} />
          </span>
          <span class="navlabel">Collapse</span>
        </button>
        <div class="navuser">
          <Show
            when={auth.me()}
            fallback={
              <NavItem href="/login" label="Sign in" icon={<LoginIcon />} />
            }
          >
            <span class="who">{handleOf(auth.me()!)}</span>
            <span class="who">{displayNameOf(auth.me()!)}</span>
            <button
              type="button"
              class="navlink navbutton"
              onClick={signout}
              title="Sign out"
              aria-label="Sign out"
            >
              <span class="navicon">
                <LogoutIcon />
              </span>
              <span class="navlabel">Sign out</span>
            </button>
          </Show>
        </div>
      </nav>
      <main class="maincol">{props.children}</main>
    </div>
  );
}
