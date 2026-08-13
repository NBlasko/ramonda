import { Component, bootstrap, createContext, createRoutes } from "../framework";

/**
 * The outlet, declared here rather than in the shared framework: it is a CLASS, and one more class
 * there is one more component in every other fixture's count.
 *
 * It publishes the params it matched, which is why the views of its table mount UNDER it rather
 * than beside it — and why two outlets on one page must not share a node.
 */
declare class RouteOutlet extends Component {
  props: { routes: unknown };
}

const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

class Deep extends Component {
  ctx = this.use(ThemeConsumer);
  render() {
    return <span>deep</span>;
  }
}

class Shallow extends Component {
  render() {
    return <span>shallow</span>;
  }
}

const inner = createRoutes({ "/deep": <Deep /> });
const outer = createRoutes({ "/": <Shallow /> });

/** The nested outlet, under a component that provides Theme. */
class Section extends Component {
  p = this.use(ThemeProvider);
  render() {
    return <RouteOutlet routes={inner} />;
  }
}

/**
 * Two outlets on one page, each with its own table.
 *
 * Hung off the shared `RouteOutlet` class, every view sat on one node and each became reachable
 * from the other — so `Deep`, which is only ever mounted under the provider `Section` puts above
 * it, would have been judged from the top-level outlet as well, with nothing above it.
 */
class App extends Component {
  render() {
    return (
      <div>
        <RouteOutlet routes={outer} />
        <Section />
      </div>
    );
  }
}

bootstrap(<App />, null);
