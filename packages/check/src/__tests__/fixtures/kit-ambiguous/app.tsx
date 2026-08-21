import { Component, __h, bootstrap } from "@ramonda/core";
import { createRouter } from "@acme/kit";

const routes = { "/": "home" };

/**
 * A kit whose members are NOT exported by the package — the ordinary case, since the factory is the
 * door and the entry names nothing.
 *
 * `Sidebar` is declared once inside the package and resolves. `Panel` is declared twice, so the
 * name answers to two different classes and the package's fragment cannot say which one was handed
 * over. Binding it to whichever appeared first would put every edge below it under an arbitrary
 * component — so it resolves to nothing, and the tag is reported as the hole it is.
 */
export const { Router, Sidebar, Panel } = createRouter(routes);

class Shell extends Component {
  render() {
    return (
      <div>
        <Sidebar />
        <Panel />
      </div>
    );
  }
}

class App extends Component {
  router = this.use(Router);
  render() {
    return <Shell />;
  }
}

bootstrap(<App />);
