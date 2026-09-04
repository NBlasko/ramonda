import { Component, Hook, bootstrap, createRoutes } from "@ramonda/core";

declare class RouteOutlet extends Component {
  props: { routes: unknown };
}

/** Both doors, as the real router declares them. */
declare class Navigator extends Hook {
  pathname: string;
  params(pattern: string): Record<string, string>;
  params<T extends Record<string, string | undefined> = Record<string, string>>(): T;
}

interface TeamParams {
  userId: string;
}

/** Correct: the key it claims is the one its route supplies. */
class RightClaim extends Component {
  nav = this.use(Navigator);
  render() {
    return <span>{this.nav.params<{ teamId: string }>().teamId}</span>;
  }
}

/** REPORTED, `type`: the route supplies `:teamId` and this claims a `userId`. */
class WrongType extends Component {
  nav = this.use(Navigator);
  render() {
    return <span>{this.nav.params<{ userId: string }>().userId}</span>;
  }
}

/** REPORTED, `destructured`: the same claim, spelled by taking the key out. */
class WrongDestructured extends Component {
  nav = this.use(Navigator);
  render() {
    const { userId } = this.nav.params();
    return <span>{userId}</span>;
  }
}

/** REPORTED, `property`: the shortest spelling of the same claim. */
class WrongProperty extends Component {
  nav = this.use(Navigator);
  render() {
    return <span>{this.nav.params().userId}</span>;
  }
}

/** Not reported: `?` says the author knows it may be absent, which is the honest read. */
class OptionalType extends Component {
  nav = this.use(Navigator);
  render() {
    return <span>{this.nav.params<{ userId?: string }>().userId}</span>;
  }
}

/** Not reported: a default is the same admission in the other spelling. */
class DefaultedDestructure extends Component {
  nav = this.use(Navigator);
  render() {
    const { userId = "" } = this.nav.params();
    return <span>{userId}</span>;
  }
}

/** Not reported, and deliberately: a read taken off a VARIABLE is the escape that stays open. */
class ThroughAVariable extends Component {
  nav = this.use(Navigator);
  render() {
    const params = this.nav.params();
    return <span>{params.userId}</span>;
  }
}

/** Not reported, and it is a named LIMIT: a type argument that is a name is not followed. */
class NamedType extends Component {
  nav = this.use(Navigator);
  render() {
    return <span>{this.nav.params<TeamParams>().userId}</span>;
  }
}

/** PROBE: a legitimate way to ask whether a key is there at all. */
class AsksIfPresent extends Component {
  nav = this.use(Navigator);
  render() {
    return <em>{this.nav.params().hasOwnProperty("teamId") ? "yes" : "no"}</em>;
  }
}

/** Not reported: nothing is named, so nothing is claimed. */
class NamesNothing extends Component {
  nav = this.use(Navigator);
  render() {
    return <em>{Object.keys(this.nav.params()).length}</em>;
  }
}

/**
 * REPORTED: rendered by two routes and only one of them supplies `id`.
 *
 * This is the whole A-or-B question. The pattern door reports when ANY reaching route fails, and so
 * does this — a component that claims a key on a route without it reads `undefined` there, and that
 * arrangement is one the source really produces. The escape for routes that disagree is to say the
 * key may be absent, not to be exempt from being asked.
 */
class SharedClaim extends Component {
  nav = this.use(Navigator);
  render() {
    return <span>{this.nav.params<{ id: string }>().id}</span>;
  }
}

/** Not reported: two routes, and BOTH supply what it claims. */
class AgreedClaim extends Component {
  nav = this.use(Navigator);
  render() {
    return <span>{this.nav.params<{ id: string }>().id}</span>;
  }
}

/** PROBE: optional chaining guards the OBJECT, not the key — and it claims `userId`, which its route lacks. */
class OptionalChain extends Component {
  nav = this.use(Navigator);
  render() {
    return <span>{this.nav.params()?.userId}</span>;
  }
}

/** A page that mounts an inner outlet, whose params REPLACE the outer ones at the runtime. */
class MemberPage extends Component {
  nav = this.use(Navigator);
  render() {
    // PROBE: claims the OUTER route's param, under an inner outlet.
    return <i>{this.nav.params<{ teamId: string }>().teamId}</i>;
  }
}

const inner = createRoutes({
  "/members/:memberId": <MemberPage />,
});

class PlayersPage extends Component {
  render() {
    return (
      <div>
        <SharedClaim />
        <AgreedClaim />
      </div>
    );
  }
}

/** The second arrival for both: `/people/:id` supplies `id`, and `/teams/:teamId` does not. */
class TeamsAside extends Component {
  render() {
    return <SharedClaim />;
  }
}

/** REPORTED as `no-outlet`: beside the outlet, and it still claims a key. */
class Beside extends Component {
  nav = this.use(Navigator);
  render() {
    return <b>{this.nav.params<{ teamId: string }>().teamId}</b>;
  }
}

/** REPORTED through the hook closure: the claim is in a hook, the route is above its user. */
class TeamHook extends Hook {
  nav = this.use(Navigator);
  get who(): string {
    return this.nav.params<{ userId: string }>().userId;
  }
}

class TeamPage extends Component {
  hooked = this.use(TeamHook);
  render() {
    return (
      <div>
        <RightClaim />
        <WrongType />
        <WrongDestructured />
        <WrongProperty />
        <OptionalType />
        <DefaultedDestructure />
        <ThroughAVariable />
        <NamedType />
        <AsksIfPresent />
        <OptionalChain />
        <TeamsAside />
        <RouteOutlet routes={inner} />
        <NamesNothing />
        {this.hooked.who}
      </div>
    );
  }
}

const routes = createRoutes({
  "/teams/:teamId": <TeamPage />,
  "/players/:id": <PlayersPage />,
  "/people/:id": <AgreedClaim />,
});

class App extends Component {
  render() {
    return (
      <div>
        <RouteOutlet routes={routes} />
        <Beside />
      </div>
    );
  }
}

bootstrap(<App />, null);
