import type { Component } from "solid-js";
import type { RouteSectionProps } from "@solidjs/router";
import { Router, Route } from "@solidjs/router";
import { AuthProvider } from "./state/auth";
import Layout from "./components/Layout";
import Home from "./routes/Home";
import Local from "./routes/Local";
import Global from "./routes/Global";
import Drive from "./routes/Drive";
import Antennas from "./routes/Antennas";
import AntennaFeed from "./routes/AntennaFeed";
import Search from "./routes/Search";
import Notifications from "./routes/Notifications";
import NoteDetail from "./routes/Note";
import Profile from "./routes/Profile";
import Settings from "./routes/Settings";
import Login from "./routes/Login";

function Root(props: RouteSectionProps) {
  return <Layout>{props.children}</Layout>;
}

const App: Component = () => {
  return (
    <AuthProvider>
      <Router root={Root}>
        <Route path="/" component={Home} />
        <Route path="/local" component={Local} />
        <Route path="/global" component={Global} />
        <Route path="/drive" component={Drive} />
        <Route path="/antennas" component={Antennas} />
        <Route path="/antennas/:id" component={AntennaFeed} />
        <Route path="/search" component={Search} />
        <Route path="/notifications" component={Notifications} />
        <Route path="/notes/:id" component={NoteDetail} />
        <Route path="/users/:id" component={Profile} />
        <Route path="/settings" component={Settings} />
        <Route path="/login" component={Login} />
      </Router>
    </AuthProvider>
  );
};

export default App;
