import { Component, __h, bootstrap, createContext } from "../framework";
import { createRouter } from "@acme/kit";

const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

const routes = { "/": "home" };

/**
 * The shape every routed app is told to write, and the one `npm create ramonda` scaffolds: the kit
 * is destructured once, at module scope, and its members are used as tags everywhere after that.
 *
 * Before this resolved, each of those tags was a hole — and a hole is an ERROR here, so a
 * scaffolded project could not build at all. Worse than the build failing: nothing BELOW an
 * unresolved tag is judged, so `Reader`'s missing provider went unreported too.
 */
export const { Router, RouteOutlet, Link } = createRouter(routes);

class Reader extends Component {
  theme = this.use(ThemeConsumer);
  render() {
    return <span>reader</span>;
  }
}

class Shell extends Component {
  render() {
    return (
      <div>
        <Link />
        <RouteOutlet />
        <Reader />
      </div>
    );
  }
}

class App extends Component {
  router = this.use(Router);
  render() {
    return <Shell />;
  }
}

bootstrap(<App />);
