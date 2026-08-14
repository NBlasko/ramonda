import { Component, bootstrap } from "../framework";
import { DataGrid, Frame, QueryConsumer, QueryProvider, SelfServing } from "@acme/ui";

/** Mounts the package's component with nothing above it. */
class Bare extends Component {
  render() {
    return <DataGrid />;
  }
}

/** The same component, under the provider the package's internals need. */
class Covered extends Component {
  q = this.use(QueryProvider);
  render() {
    return <DataGrid />;
  }
}

/**
 * A consumer mounted where its provider IS above it — and handed to `Frame` as a prop whose name
 * collides with a parameter inside the package.
 *
 * `Frame.show(view)` mounts its own argument, which the fragment records as a parameter. Filling
 * that from this binding would judge `Rogue` a second time, under `Frame`, where nothing provides
 * Query — a verdict on a mount nobody wrote.
 */
class Rogue extends Component {
  q = this.use(QueryConsumer);
  render() {
    return <span>rogue</span>;
  }
}

class Safe extends Component {
  q = this.use(QueryProvider);
  render() {
    return <Rogue />;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <Covered />
        <Bare />
        {/* Nothing above this provides Query, and nothing has to: it provides its own. */}
        <SelfServing />
        <Safe />
        <Frame view={Rogue} />
      </div>
    );
  }
}

bootstrap(<App />, null);
