import { Component, bootstrap, state } from "@ramonda/core";
import { Fetching, Grid, Plain, Table } from "@acme/hooks";

/**
 * An app using an INSTALLED package's hooks and components. Its `@StableProps` is invisible in the
 * `.d.ts`, and the package's graph carries it — so the rules report exactly the props the package
 * did not declare, where before they were silent on a hook and wrong on a component.
 */
class App extends Component {
  @state tick = 0;

  // Not reported: the package declared `key` a value.
  settled = this.use(Fetching, (self: App) => ({ key: ["x", 1], conf: undefined, n: self.tick }));

  // REPORTED: `conf` the package did not declare.
  open = this.use(Fetching, (self: App) => ({ key: "k", conf: { dense: true }, n: self.tick }));

  // REPORTED: this hook declares nothing.
  plain = this.use(Plain, (self: App) => ({ conf: { dense: true }, n: self.tick }));

  render() {
    return (
      <div>
        {/* Not reported: the package declared `conf` a value on Grid. */}
        <Grid conf={{ dense: true }} label="x" />
        {/* REPORTED: Table declares nothing. */}
        <Table conf={{ dense: true }} />
      </div>
    );
  }
}

bootstrap(<App />, null);
