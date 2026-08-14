import { Component, __h, bootstrap, createContext } from "../framework";

const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

class Outlet extends Component {
  render() {
    return <div>outlet</div>;
  }
}

class Anchor extends Component {
  render() {
    return <a>link</a>;
  }
}

/**
 * The factory in the SAME program — no `.d.ts`, no fragment, and none needed: the `return { … }` is
 * right here. This is how this repository builds its own apps, which is why the fragment-only
 * version passed every fixture and still failed the documentation site.
 *
 * `Link` is cast the way the real one is, so the type carries the shape and not the class.
 */
function createRouter(_routes: unknown) {
  return {
    RouteOutlet: Outlet,
    Link: Anchor as unknown as { new (): Component },
  };
}

export const { RouteOutlet, Link } = createRouter({});

class Reader extends Component {
  theme = this.use(ThemeConsumer);
  render() {
    return <span>reader</span>;
  }
}

class App extends Component {
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

bootstrap(<App />);
