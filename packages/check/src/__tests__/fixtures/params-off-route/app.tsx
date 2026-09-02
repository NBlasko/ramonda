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
 * REPORTED, and it used to be the fixture's proof of a silence that was really a MISS.
 *
 * Rendered BOTH inside a routed page and beside the outlet. The second arrangement has no matched
 * route at all, so the read throws there — and reporting only components that are NEVER routed made
 * the two faults disagree with each other: a component under two routes that disagree about a param
 * was reported, while this one was not, although both throw on an arrangement the source produces.
 *
 * The silence that IS correct is `Shared` below: every route above it supplies what it asked for.
 */
class Badge extends Component {
  nav = this.use(Navigator);
  render() {
    return <b>{this.nav.params("/users/:id").id}</b>;
  }
}

/**
 * REPORTED, and this is the case the whole pattern-keeping exists for.
 *
 * A CHILD of a routed page, reading a DIFFERENT route's param. It is under an outlet, so the
 * coarse question — "is anything routing to this?" — answers yes and says nothing. The route above
 * it is `/users/:id`, which supplies no `:slug`, so the router throws the moment the page opens.
 */
class WrongRouteChild extends Component {
  nav = this.use(Navigator);
  render() {
    return <i>{this.nav.params("/guide/:slug").slug}</i>;
  }
}

/**
 * Not reported: mounted under BOTH `/users/:id` and `/people/:id`, and every route above it
 * supplies the `:id` it asked for. Two routes that agree about a param are the arrangement the
 * router documents as correct — the claim is about the params, not the spelling.
 */
class Shared extends Component {
  nav = this.use(Navigator);
  render() {
    return <u>{this.nav.params("/users/:id").id}</u>;
  }
}

/**
 * REPORTED through a constant, on BOTH sides — the pattern here and the table's key below.
 *
 * Extracting the routes into constants is the tidier way to write this, and reading only literals
 * went silent on exactly that: the tidier the code, the less was checked. One hop, `const` only.
 */
class ConstPattern extends Component {
  nav = this.use(Navigator);
  render() {
    return <i>{this.nav.params(GUIDE).slug}</i>;
  }
}

/** REPORTED through a local alias, which is the other spelling people write. */
class AliasedRead extends Component {
  nav = this.use(Navigator);
  render() {
    const n = this.nav;
    return <i>{n.params("/guide/:slug").slug}</i>;
  }
}

/**
 * NOT reported, and this is a known limit rather than a decision: the navigator arrives as a PROP,
 * so there is no `this.use(Navigator)` on this class to recognise it by. Pinned here so the day it
 * starts being reported is a day somebody chose.
 */
class NavAsProp extends Component<{ nav: Navigator }> {
  render() {
    return <i>{this.props.nav.params("/guide/:slug").slug}</i>;
  }
}

/**
 * NOT reported, and the point is that the run SURVIVES it.
 *
 * Two consts naming each other. The alias walk followed the ring until the stack gave out —
 * measured before the bound, `RangeError: Maximum call stack size exceeded`, with the command
 * dying rather than reporting anything at all. TypeScript refuses this pair; this package does not
 * typecheck by design and runs over projects whose types are loose or absent, so "tsc would have
 * caught it" is not a guard it may lean on.
 */
class ARingOfAliases extends Component {
  nav = this.use(Navigator);
  render() {
    const a = b;
    const b = a;
    return <i>{a.params("/guide/:slug").slug}</i>;
  }
}

class Wrapper extends Component {
  nav = this.use(Navigator);
  render() {
    return (
      <div>
        <UserPage />
        <Badge />
        <WrongRouteChild />
        <Shared />
        <ConstPattern />
        <AliasedRead />
        <NavAsProp nav={this.nav} />
        <ARingOfAliases />
      </div>
    );
  }
}

/** `/people/:id` is the second route that agrees about `:id` — the silence `Shared` stands for. */
class PeoplePage extends Component {
  render() {
    return <Shared />;
  }
}

/** The pattern as a constant, used on BOTH sides — the read above and the key below. */
const GUIDE = "/guide/:slug";

const routes = createRoutes({
  "/users/:id": <Wrapper />,
  "/guide/:slug": <GuidePage />,
  "/people/:id": <PeoplePage />,
});

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
