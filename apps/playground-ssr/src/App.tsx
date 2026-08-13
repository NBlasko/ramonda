import { Component, Head, Host, state } from "@ramonda/core";
import { Router, RouteOutlet, Navigator, Anchor, createRoutes } from "@ramonda/router";
import { QueryClientProvider } from "@ramonda/query";
import { ProductsPage } from "./ProductsPage";
import { SignupPage } from "./SignupPage";

/**
 * Deliberately small. This app exists to answer questions a jsdom test cannot:
 * does a REAL server render the page the URL asks for, and does a REAL browser
 * adopt that markup instead of rebuilding it.
 */

@Host("div")
class Counter extends Component {
  @state clicks = 0;
  bump() {
    this.clicks++;
  }
  render() {
    return (
      <p>
        {/* Rendered on the server as 0, then interactive after hydration. */}
        <button id="bump" onClick={this.bump}>
          clicked {this.clicks} times
        </button>
      </p>
    );
  }
}

@Host("div")
class HomePage extends Component {
  head = this.use(Head, () => ({
    title: "Home — Ramonda SSR",
    description: "The home page describes itself.",
  }));
  render() {
    return (
      <div className="page">
        <h2>Home</h2>
        <p>Rendered on the server, then hydrated.</p>
        <Counter />
      </div>
    );
  }
}

@Host("div")
class AboutPage extends Component {
  // Title only. The layout's description and og:site_name must still be there.
  head = this.use(Head, () => ({ title: "About — Ramonda SSR" }));
  render() {
    return (
      <div className="page">
        <h2>About</h2>
        <p>A second route, so the server has to choose.</p>
      </div>
    );
  }
}

@Host("div")
class UserPage extends Component {
  route = this.use(Navigator);
  head = this.use(Head, () => ({
    title: `User ${this.route.params<{ id: string }>().id} — Ramonda SSR`,
    description: `Everything about user ${this.route.params<{ id: string }>().id}.`,
    // Overrides the layout's robots, and only that one.
    meta: [{ name: "robots", content: "noindex" }],
  }));
  render() {
    const id = this.route.params<{ id: string }>().id;
    return (
      <div className="page">
        <h2>User {id}</h2>
        <p>The id came out of the URL — on the server.</p>
      </div>
    );
  }
}

@Host("div")
class NotFoundPage extends Component {
  route = this.use(Navigator);
  head = this.use(Head, () => ({
    title: "404 — Ramonda SSR",
    meta: [{ name: "robots", content: "noindex,nofollow" }],
    link: [{ rel: "canonical", href: "https://example.com/404" }],
  }));
  render() {
    return (
      <div className="page">
        <h2>404</h2>
        <p>No route for {this.route.pathname}.</p>
      </div>
    );
  }
}

export const routes = createRoutes({
  "/": <HomePage />,
  "/about": <AboutPage />,
  "/users/:id": <UserPage />,
  "/products": <ProductsPage />,
  "/signup": <SignupPage />,
  "*": <NotFoundPage />,
});

@Host("div")
export class App extends Component {
  router = this.use(Router);
  /**
   * One cache for the whole app, mounted here. A hook and not a component, so it costs no
   * element — and on the server it is per request, which is the reason there is no global
   * client to import.
   */
  queries = this.use(QueryClientProvider);
  route = this.use(Navigator);
  /**
   * The layout's defaults. Every page below overrides some of these and leaves the
   * rest alone — which is the thing to watch in the tab title and in view-source.
   */
  head = this.use(Head, () => ({
    title: "Ramonda SSR playground",
    description: "The layout's description, shown when a page sets none.",
    meta: [
      { property: "og:site_name", content: "Ramonda playground" },
      { name: "robots", content: "index,follow" },
    ],
    link: [{ rel: "icon", href: "/favicon.ico" }],
  }));
  render() {
    return (
      <div className="app">
        <nav>
          <Anchor href="/">Home</Anchor>
          <Anchor href="/about">About</Anchor>
          <Anchor href="/users/42">User 42</Anchor>
          <Anchor href="/products">Products</Anchor>
          <Anchor href="/signup">Sign up</Anchor>
          <Anchor href="/nope">Missing</Anchor>
        </nav>
        <code id="path">{this.route.pathname}</code>
        <RouteOutlet routes={routes} />
      </div>
    );
  }
}
