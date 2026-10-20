import { Component } from "@ramonda/core";
import type { LeafApi } from "@ramonda/form";

declare const leaf: LeafApi<string>;
declare const value: string;

/** The REAL `LeafApi` from `@ramonda/form`: its `bind` is marked, so the spread is a field binding. */
class App extends Component {
  render() {
    return <input value={value} {...leaf.bind} aria-label="the form's own binding" />;
  }
}

export { App };
