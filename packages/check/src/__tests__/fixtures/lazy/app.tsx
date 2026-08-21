import { Component, bootstrap } from "@ramonda/core";
import { pages } from "./loaders";

declare class AsyncLoad extends Component {}

/** Built at runtime, so no bundler could split it either. */
const MISSING = `./pages/${"three"}`;

class Panel extends Component {
  /**
   * A module constant rather than a literal in the JSX: both are the same on every render, so
   * writing the arrow there is a new prop each time and RMD020 reports it. One hop to follow.
   */
  private static readonly load = () => import("./pages/one");

  render() {
    return <AsyncLoad lazy={Panel.load} namedExport="Page" />;
  }
}

class Table extends Component {
  private path = "/a";

  render() {
    return <AsyncLoad lazy={pages[this.path]} namedExport="Page" />;
  }
}

class Inline extends Component {
  render() {
    return <AsyncLoad lazy={() => import("./pages/two")} namedExport="Page" />;
  }
}

class Flaky extends Component {
  render() {
    // It fails first and succeeds later, and still reaches its module: `may reach`, not `will reach`.
    return (
      <AsyncLoad
        lazy={() => (Panel.load ? Promise.reject(new Error("first try")) : import("./pages/one"))}
        namedExport="Page"
      />
    );
  }
}

class Missing extends Component {
  render() {
    return <AsyncLoad lazy={() => import(MISSING)} namedExport="Page" />;
  }
}

class Absent extends Component {
  render() {
    return <AsyncLoad lazy={() => import("./pages/one")} namedExport="NotThere" />;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <Panel />
        <Table />
        <Inline />
        <Flaky />
        <Missing />
        <Absent />
      </div>
    );
  }
}

bootstrap(<App />, null);
