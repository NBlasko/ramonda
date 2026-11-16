import { Component, bootstrap, createRoutes } from "@ramonda/core";
import { RouteOutlet } from "./router";
import { tournamentRoutes } from "./modules/tournaments/routes";
import { debugRoutes } from "./modules/debug/routes";

class Home extends Component {
  render() {
    return <p>home</p>;
  }
}

/** The app's table, put together from parts: a module's, one under a condition, and its own. */
const routes = createRoutes(tournamentRoutes, import.meta.env.DEV ? debugRoutes : undefined, { "/": <Home /> });

class App extends Component {
  render() {
    return (
      <main>
        <RouteOutlet routes={routes} />
      </main>
    );
  }
}

bootstrap(<App />, null);
