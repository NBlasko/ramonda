import { Component, bootstrap, createRoutes } from "@ramonda/core";
import { Link, RouteOutlet } from "@ramonda/router";
import { features } from "./features";

class Page extends Component {
  render() {
    return <p>page</p>;
  }
}

/** A part under a condition, inside a part under another: `/debug/admin` needs BOTH. */
const adminDebugRoutes = createRoutes({ "/debug/admin": <Page /> });
const debugRoutes = createRoutes(features.admin ? adminDebugRoutes : undefined, { "/debug": <Page /> });
const routes = createRoutes(import.meta.env.DEV ? debugRoutes : undefined, { "/": <Page /> });

class Nav extends Component {
  render() {
    return (
      <nav>
        {/* REPORTED: under DEV only, and `/debug/admin` needs `features.admin` as well. */}
        {import.meta.env.DEV && <Link href="/debug/admin">admin</Link>}
        {/* Silent: under both. */}
        {import.meta.env.DEV && features.admin && <Link href="/debug/admin">admin</Link>}
        {/* Silent: `/debug` needs DEV alone. */}
        {import.meta.env.DEV && <Link href="/debug">debug</Link>}
      </nav>
    );
  }
}

/** Silent: everything after `if (!cond) return` is under `cond`. Review round 3. */
class EarlyOut extends Component {
  render() {
    if (!import.meta.env.DEV) return null;
    return <Link href="/debug">debug</Link>;
  }
}

/** REPORTED: the early return is the other way round, so what follows is NOT under it. */
class EarlyOutBackwards extends Component {
  render() {
    if (import.meta.env.DEV) return null;
    return <Link href="/debug">debug</Link>;
  }
}

class App extends Component {
  render() {
    return (
      <main>
        <Nav />
        <EarlyOut />
        <EarlyOutBackwards />
        <RouteOutlet routes={routes} />
      </main>
    );
  }
}

bootstrap(<App />, null);
