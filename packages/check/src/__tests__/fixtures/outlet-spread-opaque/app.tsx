import { Component, bootstrap, createRoutes } from "@ramonda/core";

declare class RouteOutlet extends Component {
  props: { routes: unknown };
}

/** Built by a call, so nothing here can say which table it carries. */
declare function outletProps(): { routes: unknown };

class Page extends Component {
  render() {
    return <span>page</span>;
  }
}

/**
 * Handed to no outlet this can SEE — and the spread below could be the outlet that takes it, so
 * nothing is reported. This is the case that is silent on purpose.
 */
const routes = createRoutes({ "/": <Page /> });

class App extends Component {
  render() {
    return <RouteOutlet {...outletProps()} />;
  }
}

bootstrap(<App />, null);
