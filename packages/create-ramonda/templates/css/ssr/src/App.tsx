import { Component, Head, state } from "@ramonda/core";
import { createRoutes, createRouter } from "@ramonda/router";

// Each `@@( … )` is a style block: real CSS for one element, compiled to classes at build time.
// `$color.accent` and the rest are the tokens declared in ramonda.css.ts. The blocks are shared by
// every page below, so they are written once, here.

const spin = @@keyframes(
  to {
    transform: rotate(360deg);
  }
);

const page = @@(
  min-height: $size.screen;
  background-color: $color.page;
  color: $color.text;
);

const column = @@(
  box-sizing: border-box;
  max-width: $size.column;
  margin: 0 auto;
  padding: $space.l;
  text-align: center;
);

const nav = @@(
  display: flex;
  gap: $space.m;
  justify-content: center;
);

const link = @@(
  color: $color.accent;
  font-weight: 600;
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
);

const card = @@(
  box-sizing: border-box;
  max-width: $size.card;
  margin: $space.l auto;
  padding: $space.xl;
  background-color: $color.surface;
  border: $size.line solid $color.line;
  border-radius: $radius.l;
);

const mark = @@(
  display: block;
  margin: 0 auto $space.m;
  color: $color.accent;
  animation: $(spin) 9000ms linear infinite;
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
);

const title = @@(
  margin: 0;
  font-size: $font.l;
);

const tagline = @@(
  margin: $space.s 0 $space.l;
  color: $color.muted;
  line-height: 1.6;
);

const button = @@(
  font: inherit;
  font-weight: 600;
  color: $color.onAccent;
  background-color: $color.accent;
  border: none;
  border-radius: $radius.m;
  padding: $space.m $space.l;
  cursor: pointer;
  &:hover {
    filter: brightness(1.08);
  }
  &:focus-visible {
    outline: $size.focus solid $color.accent;
    outline-offset: $space.xs;
  }
);

const hint = @@(
  margin: $space.l 0 0;
  color: $color.muted;
  font-size: $font.s;
  line-height: 1.5;
);

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
      <main className={card}>
        <svg className={mark} viewBox="-32 -32 64 64" width="64" height="64" aria-hidden="true">
          <g fill="currentColor">
            <ellipse cx="0" cy="-14" rx="8.6" ry="14" />
            <ellipse cx="0" cy="-14" rx="8.6" ry="14" transform="rotate(72)" />
            <ellipse cx="0" cy="-14" rx="8.6" ry="14" transform="rotate(144)" />
            <ellipse cx="0" cy="-14" rx="8.6" ry="14" transform="rotate(216)" />
            <ellipse cx="0" cy="-14" rx="8.6" ry="14" transform="rotate(288)" />
          </g>
          <circle r="6.6" fill="#e9b44c" />
        </svg>
        <h1 className={title}>Ramonda</h1>
        <p className={tagline}>Server-rendered, then hydrated.</p>
        <button type="button" className={button} onclick={this.increment}>
          count is {this.count}
        </button>
        <p className={hint}>This page is prerendered at build time — pure static HTML.</p>
      </main>
    );
  }
}

/** A second page, configured as ISR: baked, then rebaked on a timer — never per request. */
class AboutPage extends Component {
  head = this.use(Head, () => ({ title: "About — Ramonda" }));
  render() {
    return (
      <main className={card}>
        <h1 className={title}>About</h1>
        <p className={tagline}>Rendered on the server, cached, and revalidated on a schedule (ISR).</p>
        <p className={hint}>Static content that can go stale — regenerated in the background.</p>
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
      <main className={card}>
        <h1 className={title}>Hello, {name}!</h1>
        <p className={tagline}>Rendered per request — its content depends on the URL.</p>
      </main>
    );
  }
}

class NotFound extends Component {
  render() {
    return (
      <main className={card}>
        <h1 className={title}>Not found</h1>
        <p className={tagline}>No route matched this URL.</p>
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
      <div className={page}>
        <div className={column}>
          <nav className={nav}>
            <Link className={link} href="/">
              Home
            </Link>
            <Link className={link} href="/about">
              About
            </Link>
            <Link className={link} href={route("/hello/:name", { name: "world" })}>
              Greet
            </Link>
          </nav>
          <RouteOutlet routes={routes} />
          <a className={link} href="https://ramonda.dev" target="_blank" rel="noreferrer">
            Read the docs →
          </a>
        </div>
      </div>
    );
  }
}
