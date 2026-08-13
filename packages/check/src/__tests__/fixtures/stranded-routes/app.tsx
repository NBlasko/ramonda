import { Component, bootstrap, createRoutes } from "../framework";

declare class RouteOutlet extends Component {
  props: { routes: unknown };
}

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

/** Mounted by an outlet the root reaches — the ordinary case, and it must stay silent. */
const live = createRoutes({ "/": <Home /> });

/** Written, and handed to no outlet at all. */
const forgotten = createRoutes({ "/archive": <Archive />, "/archive/:id": <Archive /> });

/** Handed to an outlet, in a component nothing mounts. */
const stranded = createRoutes({ "/draft": <Draft /> });

export class Unmounted extends Component {
  render() {
    return <RouteOutlet routes={stranded} />;
  }
}

class App extends Component {
  render() {
    return <RouteOutlet routes={live} />;
  }
}

bootstrap(<App />, null);
