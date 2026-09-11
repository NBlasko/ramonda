import { Component, Hook, bootstrap, createRoutes } from "@ramonda/core";

/**
 * A hook is an extension of the component that uses it, and every case here is about one thing: the
 * route above the USER is the route the hook reads under.
 *
 * `this.use(X)` is a `uses` edge and never a mount, so the walk that follows mounts leaves a hook
 * out of every answer it produces. `closeOverHooks` puts it back in, with the arrivals carried.
 */
declare class RouteOutlet extends Component {
  props: { routes: unknown };
}

declare class Navigator extends Hook {
  pathname: string;
  params(pattern: string): Record<string, string>;
}

/** Correct, and it used to be REPORTED as `no-outlet`: its user is mounted at exactly this route. */
class TeamData extends Hook {
  nav = this.use(Navigator);
  get team(): string {
    return this.nav.params("/teams/:teamId").teamId;
  }
}

/** The fault, one hop away from the component: `/teams/:teamId` supplies no `:slug`. */
class WrongInHook extends Hook {
  nav = this.use(Navigator);
  get slug(): string {
    return this.nav.params("/guide/:slug").slug;
  }
}

/**
 * Two hops down, reached under two routes — the case the closure is a FIXPOINT for.
 *
 * `InnerRead` asks for `:b`. `BetaPage` supplies it, `AlphaPage` does not, and neither page touches
 * `InnerRead` directly: both go through `OuterWrap`, which is the shape `@ramonda/query`'s own
 * provider has.
 *
 * Which of the two is the condemning arrival is deliberate, and it is why this fixture proves
 * anything. The closure drains its queue last-in-first-out from the walk's own order, so the route
 * declared LATER in the table is closed FIRST: `/beta/:b` reaches `InnerRead` before `/alpha/:x`
 * does. Ask for `:x` instead and the failing arrival is the first one seen, which one pass finds by
 * luck. Asking for `:b` puts the fault behind a second growth of `OuterWrap`'s arrivals, and only a
 * fixpoint gets there.
 */
class InnerRead extends Hook {
  nav = this.use(Navigator);
  get b(): string {
    return this.nav.params("/beta/:b").b;
  }
}

class OuterWrap extends Hook {
  inner = this.use(InnerRead);
  get b(): string {
    return this.inner.b;
  }
}

/** Used by TWO components on different routes. `:id` is supplied by neither, so both arrivals fail. */
class SharedData extends Hook {
  nav = this.use(Navigator);
  get id(): string {
    return this.nav.params("/users/:id").id;
  }
}

/** Nothing uses it. That is `deadOnes`' finding, and this rule must stay quiet about it. */
class OrphanData extends Hook {
  nav = this.use(Navigator);
  get slug(): string {
    return this.nav.params("/guide/:slug").slug;
  }
}

class TeamPage extends Component {
  data = this.use(TeamData);
  wrong = this.use(WrongInHook);
  shared = this.use(SharedData);
  render() {
    return (
      <div>
        {this.data.team}
        {this.wrong.slug}
        {this.shared.id}
      </div>
    );
  }
}

class GuidePage extends Component {
  shared = this.use(SharedData);
  render() {
    return <span>{this.shared.id}</span>;
  }
}

class AlphaPage extends Component {
  wrap = this.use(OuterWrap);
  render() {
    return <b>{this.wrap.b}</b>;
  }
}

class BetaPage extends Component {
  wrap = this.use(OuterWrap);
  render() {
    return <i>{this.wrap.b}</i>;
  }
}

const routes = createRoutes({
  "/teams/:teamId": <TeamPage />,
  "/guide/:slug": <GuidePage />,
  "/users/:id": <span>a user</span>,
  "/alpha/:x": <AlphaPage />,
  "/beta/:b": <BetaPage />,
});

class App extends Component {
  render() {
    return <RouteOutlet routes={routes} />;
  }
}

bootstrap(<App />, null);
