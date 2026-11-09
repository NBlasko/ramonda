import { Component, Hook, StableProps } from "@ramonda/core";

/**
 * A package's hooks and a component, some with a `@StableProps` declaration. A `.d.ts` carries no
 * decorators, so an app can see these only through the package's published graph.
 */
@StableProps("key")
export class Fetching extends Hook<{ key: unknown; conf: unknown; n: number }> {}

export class Plain extends Hook<{ conf: unknown; n: number }> {}

@StableProps("conf")
export class Grid extends Component<{ conf: unknown; label: string }> {
  render() {
    return <i />;
  }
}

export class Table extends Component<{ conf: unknown }> {
  render() {
    return <b />;
  }
}
