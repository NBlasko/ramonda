import { Component, bootstrap, state } from "@ramonda/core";
import { Router, RouteOutlet, Navigator, Link } from "@ramonda/router";
import { QueryClientProvider } from "@ramonda/query";
import { ThemeProvider, ThemedBadge } from "./theme";
import { routes } from "./routes";
import "./styles";

/* ═══════════════════════════════════════════════════════════════════════
   Ramonda showcase + router demo.
   - Nav uses <Link> (real <a>, race-free state-first navigation).
   - "/showcase" mounts a grid exercising every decorator + nested hooks.
   - "/table" exercises list(): nested lists, two lists in one component, a matrix.
   - Open devtools (🌸 badge / Alt+D) → COMPONENTS to inspect the live tree.
     (The import at the bottom is what makes that badge exist — see the note there.)

   Pages live in ./pages (one per route), the bigger demos in ./demos.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Nav bar (Links + back/forward + live pathname) ────────────────────── */
class NavBar extends Component {
  route = this.use(Navigator);
  render() {
    return (
      <nav className="nav">
        <Link href="/" className="navlink">
          Home
        </Link>
        <Link href="/showcase" className="navlink">
          Showcase
        </Link>
        <Link href="/table" className="navlink">
          Table
        </Link>
        <Link href="/slots" className="navlink">
          Slots
        </Link>
        <Link href="/async" className="navlink">
          Async
        </Link>
        <Link href="/query" className="navlink">
          Query
        </Link>
        <Link href="/form" className="navlink">
          Form
        </Link>
        <Link href="/users/42" className="navlink">
          User 42
        </Link>
        <Link href="/about" className="navlink">
          About
        </Link>
        <Link href="/diagnostics" className="navlink">
          Diagnostics
        </Link>
        <button onClick={this.route.back}>← Back</button>
        <button onClick={this.route.forward}>Forward →</button>
        <code className="path">{this.route.pathname}</code>
      </nav>
    );
  }
}

/* ── App root: theme provider + nav + router outlet ────────────────────── */
class App extends Component {
  @state theme = "light";
  themeProvider = this.use(ThemeProvider, () => ({ theme: this.theme }));
  // Router is a hook: it owns the route store and publishes it to this whole
  // subtree, so the NavBar has context and the RouteOutlet swaps on navigation.
  // No wrapper element — the app root stays a single <div>.
  router = this.use(Router);
  // The query cache belongs to this tree and reaches every page through context.
  // On the app root because that is where a real app puts it — one cache per
  // render tree, never a module-level singleton.
  // The bag directly: the defaults never change, and a callback would build a fresh
  // `defaults` object on every render of the root — a changed prop each time (RMD022).
  query = this.use(QueryClientProvider, {
    defaults: { staleTime: 5_000, retry: 1 },
  });
  toggleTheme() {
    this.theme = this.theme === "light" ? "dark" : "light";
  }
  render() {
    return (
      <div className={`app ${this.theme}`}>
        <header>
          <div className="row">
            <h1>Ramonda 🌸</h1>
            <ThemedBadge />
            <button onClick={this.toggleTheme}>toggle theme</button>
            <span className="muted small">devtools: 🌸 badge / Alt+D → COMPONENTS</span>
          </div>
          <NavBar />
        </header>
        <RouteOutlet routes={routes} />
      </div>
    );
  }
}

// biome-ignore lint/style/noNonNullAssertion: #app exists in index.html
bootstrap(<App />, document.querySelector<HTMLDivElement>("#app")!);

/**
 * The devtools panel — the flower badge, or Alt+D.
 *
 * The app has to ask for it. Core loads the panel itself in a development build, but through a
 * dynamic import whose specifier is a VARIABLE marked `@vite-ignore` — deliberately, so
 * `@ramonda/core` does not make `@ramonda/devtools` a resolution requirement for every project
 * that type-checks it. Vite therefore leaves the string alone, the browser tries to fetch
 * `@ramonda/devtools` as a URL, and core's `.catch()` swallows the failure because the panel is
 * genuinely optional. The result is silence: the development logs appear, and no badge does.
 *
 * `import.meta.env.DEV` so a production build drops it.
 */
if (import.meta.env.DEV) void import("@ramonda/devtools");
