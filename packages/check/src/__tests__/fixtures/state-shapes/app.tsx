import { Component, bootstrap, created, persist, renderToString, state } from "@ramonda/core";

void renderToString;

declare function loadRows(): [string, number][];

/** ✗ The plain case: a `Map` in the initializer. */
class Plain extends Component {
  @state rows = new Map<string, number>();
  render() {
    return null;
  }
}

/** ✗ Declared with no initializer and ASSIGNED in a lifecycle — the shape a fetch produces. */
class AssignedLater extends Component {
  @state rows!: Map<string, number>;
  @created()
  load() {
    this.rows = new Map(loadRows());
  }
  render() {
    return null;
  }
}

/** ✗ The same for `@persist`, whose rule asks without a gate. */
class PersistedLater extends Component {
  @persist rows!: Map<string, number>;
  @created()
  load() {
    this.rows = new Map(loadRows());
  }
  render() {
    return null;
  }
}

/** ✗ A `Date` assigned in a plain method. */
class DateLater extends Component {
  @state at!: Date;
  touch() {
    this.at = new Date();
  }
  render() {
    return null;
  }
}

/** ✓ A plain field, which is not in the blob at all. */
class PlainField extends Component {
  rows = new Map<string, number>();
  render() {
    return null;
  }
}

/** ✓ Assigned something the blob carries. */
class Fine extends Component {
  @state rows: string[] = [];
  @created()
  load() {
    this.rows = ["a"];
  }
  render() {
    return null;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <Plain />
        <AssignedLater />
        <PersistedLater />
        <DateLater />
        <PlainField />
        <Fine />
      </div>
    );
  }
}

bootstrap(<App />, null);
