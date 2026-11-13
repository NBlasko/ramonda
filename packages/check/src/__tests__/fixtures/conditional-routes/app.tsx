import { Component, bootstrap, createRoutes } from "@ramonda/core";
import { Link, Navigator, RouteOutlet, route } from "@ramonda/router";
import { features } from "./features";
import { AdminPage, DebugCache, DebugPage, Home } from "./pages";

const debugRoutes = createRoutes({ "/debug": <DebugPage />, "/debug/cache": <DebugCache /> });
const adminRoutes = createRoutes({ "/admin": <AdminPage />, "/admin/:id": <AdminPage /> });

const routes = createRoutes(import.meta.env.DEV ? debugRoutes : undefined, features.admin ? adminRoutes : undefined, {
  "/": <Home />,
});

class NavBar extends Component {
  nav = this.use(Navigator);
  id = "7";

  goAdmin() {
    // Silent: under the same condition its part is.
    if (features.admin) this.nav.push("/admin");
  }

  goAdminAnyway() {
    // REPORTED: `/admin` exists only when `features.admin`.
    this.nav.push("/admin");
  }

  render() {
    return (
      <nav>
        <Link href="/">home</Link>
        {/* REPORTED: `/debug` exists only in development, and this link is in every build. */}
        <Link href="/debug">debug</Link>
        {/* Silent: under the condition. */}
        {import.meta.env.DEV && <Link href="/debug">debug</Link>}
        {/* REPORTED: under the OPPOSITE of the condition — the one build that has no `/debug`. */}
        {!import.meta.env.DEV && <Link href="/debug/cache">cache</Link>}
        {/* REPORTED: a filled pattern is the same route. */}
        <Link href={`/admin/${this.id}`}>one</Link>
        {/* REPORTED: and so is what `route()` builds. */}
        <Link href={route("/admin/:id", { id: this.id })}>two</Link>
      </nav>
    );
  }
}

/** The condition is the SAME one, written another way — every link here is silent. */
const isAdmin = features.admin;

class SameCondition extends Component {
  nav = this.use(Navigator);

  goAdmin() {
    // A `const` holding the condition, one hop away.
    if (isAdmin) this.nav.push("/admin");
  }

  render() {
    // `PROD` is `!DEV`: the build that is not production is the development one.
    return <aside>{!import.meta.env.PROD && <Link href="/debug">debug</Link>}</aside>;
  }
}

class App extends Component {
  render() {
    return (
      <main>
        <NavBar />
        <SameCondition />
        <RouteOutlet routes={routes} />
      </main>
    );
  }
}

bootstrap(<App />, null);
