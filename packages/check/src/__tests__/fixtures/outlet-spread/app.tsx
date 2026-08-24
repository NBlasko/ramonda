import { Component, bootstrap, createRoutes } from "@ramonda/core";

declare class RouteOutlet extends Component {
  props: { routes: unknown };
}

class Page extends Component {
  render() {
    return <span>page</span>;
  }
}

const routes = createRoutes({ "/": <Page /> });

/** The props, written down. A spread is not a hiding place when the object is right here. */
const outletProps = { routes };

class App extends Component {
  render() {
    return <RouteOutlet {...outletProps} />;
  }
}

bootstrap(<App />, null);
