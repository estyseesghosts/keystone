import type { Component } from "solid-js";
import { createEffect } from "solid-js";
import type { RouteSectionProps } from "@solidjs/router";
import { Router, Route } from "@solidjs/router";
import { AuthProvider } from "./state/auth";
import { AppearanceProvider } from "./state/appearance";
import { EmojiPrefsProvider } from "./state/emojiPrefs";
import { PostboxProvider } from "./state/postbox";
import { loadCustomEmojis } from "./api/customEmoji";
import Layout from "./components/Layout";
import Home from "./routes/Home";
import Local from "./routes/Local";
import Global from "./routes/Global";
import Drive from "./routes/Drive";
import Antennas from "./routes/Antennas";
import AntennaFeed from "./routes/AntennaFeed";
import Search from "./routes/Search";
import Notifications from "./routes/Notifications";
import FollowRequests from "./routes/FollowRequests";
import Favorites from "./routes/Favorites";
import NoteDetail from "./routes/Note";
import Profile, { FollowersPage, FollowingPage } from "./routes/Profile";
import Settings, { AccountSettings, DisplaySettings, ImportSettings, MutesSettings, ExportSettings, ReactionsSettings } from "./routes/Settings";
import Login from "./routes/Login";

function Root(props: RouteSectionProps) {
  // Custom emoji listing for names/reactions/text: fetch once at
  // startup (session-cached, per-target) so glyphs render without
  // opening the picker first. Idempotent — the picker kicks it too.
  createEffect(() => {
    loadCustomEmojis();
  });
  return <Layout>{props.children}</Layout>;
}

const App: Component = () => {
  return (
    <AppearanceProvider>
    <EmojiPrefsProvider>
    <AuthProvider>
      <PostboxProvider>
        <Router root={Root}>
          <Route path="/" component={Home} />
          <Route path="/local" component={Local} />
          <Route path="/global" component={Global} />
          <Route path="/drive" component={Drive} />
          <Route path="/antennas" component={Antennas} />
          <Route path="/antennas/:id" component={AntennaFeed} />
          <Route path="/search" component={Search} />
          <Route path="/notifications" component={Notifications} />
          <Route path="/follow-requests" component={FollowRequests} />
          <Route path="/favorites" component={Favorites} />
          <Route path="/notes/:id" component={NoteDetail} />
          <Route path="/users/:id" component={Profile} />
          <Route path="/users/:id/followers" component={FollowersPage} />
          <Route path="/users/:id/following" component={FollowingPage} />
          <Route path="/settings" component={Settings} />
          <Route path="/settings/account" component={AccountSettings} />
          <Route path="/settings/display" component={DisplaySettings} />
          <Route path="/settings/reactions" component={ReactionsSettings} />
          <Route path="/settings/mutes" component={MutesSettings} />
          <Route path="/settings/import" component={ImportSettings} />
          <Route path="/settings/export" component={ExportSettings} />
          <Route path="/login" component={Login} />
        </Router>
      </PostboxProvider>
      </AuthProvider>
    </EmojiPrefsProvider>
    </AppearanceProvider>
  );
};

export default App;
