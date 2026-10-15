import type { Component } from "solid-js";
import type { RouteSectionProps } from "@solidjs/router";
import { Router, Route } from "@solidjs/router";
import { AuthProvider } from "./state/auth";
import Layout from "./components/Layout";
import Home from "./routes/Home";
import Local from "./routes/Local";
import Global from "./routes/Global";
import Notifications from "./routes/Notifications";
import NoteDetail from "./routes/Note";
import Profile from "./routes/Profile";
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
        <Route path="/notifications" component={Notifications} />
        <Route path="/notes/:id" component={NoteDetail} />
        <Route path="/users/:id" component={Profile} />
        <Route path="/login" component={Login} />
      </Router>
    </AuthProvider>
  );
};

export default App;
