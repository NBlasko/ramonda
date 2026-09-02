import { Component, Hook, bootstrap, createRoutes } from "@ramonda/core";

/**
 * The outlet and the navigator, declared HERE rather than in the shared framework: both are
 * classes, and one more class there is one more component in every other fixture's counts.
 *
 * `Navigator.params(pattern)` throws when no outlet matched above the component that read it —
 * the params context is `optional`, deliberately, because reading `pathname` beside an outlet is
 * correct. So the fault is the METHOD, not the consumer, and nothing else can see it.
 */
declare class RouteOutlet extends Component {
  props: { routes: unknown };
}

declare class Navigator extends Hook {
  pathname: string;
  params(pattern?: string): Record<string, string>;
}

/** A routed page. It is under the outlet, so its read is answerable. */
class UserPage extends Component {
  nav = this.use(Navigator);
  render() {
    return <span>{this.nav.params("/users/:id").id}</span>;
  }
}

/** A page whose read is inside a HELPER member rather than in render — the same fault. */
class GuidePage extends Component {
  nav = this.use(Navigator);
  private get slug(): string {
    return this.nav.params("/guide/:slug").slug;
  }
  render() {
    return <span>{this.slug}</span>;
  }
}

/**
 * REPORTED — chrome beside the outlet, which is the arrangement the router documents. `pathname`
 * here is correct; `params(...)` is a throw on every render.
 */
class NavBar extends Component {
  nav = this.use(Navigator);
  render() {
    return (
      <nav>
        <a href={this.nav.pathname}>here</a>
        <span>{this.nav.params("/users/:id").id}</span>
      </nav>
    );
  }
}

/** Not reported: reads `pathname` only, which needs no matched route. */
class Footer extends Component {
  nav = this.use(Navigator);
  render() {
    return <small>{this.nav.pathname}</small>;
  }
}

/** Not reported: the untyped door, which names no pattern and claims no route. */
class Breadcrumbs extends Component {
  nav = this.use(Navigator);
  render() {
    return <em>{Object.keys(this.nav.params()).length}</em>;
  }
}

/**
 * Not reported: rendered BOTH beside the outlet and inside a routed page. One arrangement works,
 * and a component that is right on any path it is mounted on is not a fault.
 */
class Badge extends Component {
  nav = this.use(Navigator);
  render() {
    return <b>{this.nav.params("/users/:id").id}</b>;
  }
}

class Wrapper extends Component {
  render() {
    return (
      <div>
        <UserPage />
        <Badge />
      </div>
    );
  }
}

const routes = createRoutes({ "/users/:id": <Wrapper />, "/guide/:slug": <GuidePage /> });

class App extends Component {
  render() {
    return (
      <div>
        <NavBar />
        <RouteOutlet routes={routes} />
        <Footer />
        <Breadcrumbs />
        <Badge />
      </div>
    );
  }
}

bootstrap(<App />, null);
