import { Component, bootstrap, state } from "@ramonda/core";
import { Router, RouteOutlet, Navigator, Link } from "@ramonda/router";
import { ThemeProvider, ThemedBadge } from "./theme";
import { routes } from "./routes";
import "./styles";

/* ═══════════════════════════════════════════════════════════════════════
   Ramonda showcase + router demo.
   - Nav uses <Link> (real <a>, race-free state-first navigation).
   - "/showcase" mounts a grid exercising every decorator + nested hooks.
   - "/table" exercises list(): nested lists, two lists in one component, a matrix.
   - Open devtools (🌸 badge / Alt+D) → COMPONENTS to inspect the live tree.

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
        <Link href="/users/42" className="navlink">
          User 42
        </Link>
        <Link href="/about" className="navlink">
          About
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
