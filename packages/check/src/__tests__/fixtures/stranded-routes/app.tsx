import { Component, bootstrap, createRoutes, createRoutes as makeRoutes } from "@ramonda/core";
import { RouteOutlet, RouteOutlet as Aliased, createRouter } from "./kit";

class Home extends Component {
  render() {
    return <span>home</span>;
  }
}

export class Archive extends Component {
  render() {
    return <span>archive</span>;
  }
}

export class Draft extends Component {
  render() {
    return <span>draft</span>;
  }
}

class Held extends Component {
  render() {
    return <span>held</span>;
  }
}

class Lifted extends Component {
  render() {
    return <span>lifted</span>;
  }
}

class Renamed extends Component {
  render() {
    return <span>renamed</span>;
  }
}

class Imported extends Component {
  render() {
    return <span>imported</span>;
  }
}

/** Mounted by an outlet the root reaches — the ordinary case, and it must stay silent. */
const live = createRoutes({ "/": <Home /> });

/** Written, and handed to no outlet at all. */
const forgotten = createRoutes({ "/archive": <Archive />, "/archive/:id": <Archive /> });

/** Handed to an outlet, in a component nothing mounts. */
const stranded = createRoutes({ "/draft": <Draft /> });

/** The factory under an alias. Nothing about the table changes because the import was renamed. */
const aliasedFactory = makeRoutes({ "/imported": <Imported /> });

/** Handed over off a FIELD, and through a LOCAL — the two hops a routed app actually writes. */
const held = createRoutes({ "/held": <Held /> });
const lifted = createRoutes({ "/lifted": <Lifted /> });

/** The table the renamed outlet is handed. */
const renamed = createRoutes({ "/renamed": <Renamed /> });

/** The kit, destructured and RENAMED — what a typed router kit looks like at the call site. */
const { RouteOutlet: Outlet } = createRouter(renamed);

export class Unmounted extends Component {
  render() {
    return <RouteOutlet routes={stranded} />;
  }
}

class App extends Component {
  table = held;
  render() {
    const local = lifted;
    return (
      <div>
        <RouteOutlet routes={live} />
        <RouteOutlet routes={this.table} />
        <RouteOutlet routes={local} />
        <Outlet routes={renamed} />
        <Aliased routes={aliasedFactory} />
      </div>
    );
  }
}

bootstrap(<App />, null);
