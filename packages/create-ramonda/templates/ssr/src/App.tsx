import { Component, Head, state } from "@ramonda/core";
import { createRoutes, createRouter } from "@ramonda/router";

/** The home page — static: the same for everyone, so the build bakes it to a file. */
class HomePage extends Component {
  /**
   * The page's title and description, in the HTML the server sends.
   *
   * Not decoration: server rendering earns its cost with readers who never run your JavaScript —
   * a crawler, a link preview, a reader mode — and what they see is what is in the file. A page
   * that sets its title on hydration has none for any of them.
   *
   * Each route sets its own; whatever a route leaves out falls back to the layout's below.
   */
  head = this.use(Head, () => ({
    title: "Home — Ramonda",
    description: "A server-rendered Ramonda app, prerendered at build time.",
  }));
  @state count = 0;
  increment(): void {
    this.count = this.count + 1;
  }
  render() {
    return (
      <main className="card">
        <svg className="mark" viewBox="-32 -32 64 64" width="64" height="64" aria-hidden="true">
          <g fill="currentColor">
            <ellipse cx="0" cy="-14" rx="8.6" ry="14" />
            <ellipse cx="0" cy="-14" rx="8.6" ry="14" transform="rotate(72)" />
            <ellipse cx="0" cy="-14" rx="8.6" ry="14" transform="rotate(144)" />
            <ellipse cx="0" cy="-14" rx="8.6" ry="14" transform="rotate(216)" />
            <ellipse cx="0" cy="-14" rx="8.6" ry="14" transform="rotate(288)" />
          </g>
          <circle r="6.6" fill="#e9b44c" />
        </svg>
        <h1>Ramonda</h1>
        <p className="tagline">Server-rendered, then hydrated.</p>
        <button type="button" onclick={this.increment}>
          count is {this.count}
        </button>
        <p className="hint">This page is prerendered at build time — pure static HTML.</p>
      </main>
    );
  }
}

/** A second page, configured as ISR: baked, then rebaked on a timer — never per request. */
class AboutPage extends Component {
  head = this.use(Head, () => ({ title: "About — Ramonda" }));
  render() {
    return (
      <main className="card">
        <h1>About</h1>
        <p className="tagline">Rendered on the server, cached, and revalidated on a schedule (ISR).</p>
        <p className="hint">Static content that can go stale — regenerated in the background.</p>
      </main>
    );
  }
}

/** A per-request page: the `:name` param differs every time, so it renders on each request. */
class GreetingPage extends Component {
  private nav = this.use(Navigator);
  // Below `nav` on purpose: field initialisers run in order, so reading `this.nav` above this
  // point would read the field before it exists.
  head = this.use(Head, (self: GreetingPage) => ({
    title: `Hello, ${self.nav.params("/hello/:name").name} — Ramonda`,
  }));
  render() {
    const { name } = this.nav.params("/hello/:name");
    return (
      <main className="card">
        <h1>Hello, {name}!</h1>
        <p className="tagline">Rendered per request — its content depends on the URL.</p>
      </main>
    );
  }
}

class NotFound extends Component {
  render() {
    return (
      <main className="card">
        <h1>Not found</h1>
        <p className="tagline">No route matched this URL.</p>
      </main>
    );
  }
}

// The route table — shared by the client and the server. `createRoutes` remembers the exact
// paths in its type, and `createRouter` binds `<Link href>` / `route()` to them, so a typo in a
// link is a compile error. `server-routes.ts` says which route renders how (static / ISR / per
// request).
export const routes = createRoutes({
  "/": <HomePage />,
  "/about": <AboutPage />,
  "/hello/:name": <GreetingPage />,
  "*": <NotFound />,
});

export const { Router, RouteOutlet, Navigator, Link, route } = createRouter(routes);

/** The app shell: navigation that stays put, and the outlet that swaps as you move. */
export class App extends Component {
  router = this.use(Router);
  render() {
    return (
      <div className="app">
        <nav className="nav">
          <Link href="/">Home</Link>
          <Link href="/about">About</Link>
          <Link href={route("/hello/:name", { name: "world" })}>Greet</Link>
        </nav>
        <RouteOutlet routes={routes} />
        <a className="docs" href="https://ramonda.dev" target="_blank" rel="noreferrer">
          Read the docs →
        </a>
      </div>
    );
  }
}
