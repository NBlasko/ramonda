import { Component, bootstrap } from "../framework";
import { DataGrid, QueryProvider } from "@acme/ui";

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

class App extends Component {
  render() {
    return (
      <div>
        <Covered />
        <Bare />
      </div>
    );
  }
}

bootstrap(<App />, null);
