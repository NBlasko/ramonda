/**
 * A DELIBERATELY faulty component, for `scripts/diagnostics.mjs`. Not part of the app.
 *
 * Every mistake in here is on purpose and each one is load-bearing — do not "fix" the `class`
 * attribute or the function in `@state`. What the script asserts is that reporting those faults
 * reaches a collector during a REAL server render: this bundle is built with the same esbuild
 * invocation `build:server` uses, `__DEV__` on, the devtools import pointed at nothing, and driven
 * under linkedom. Nothing else in this repository covers that — the hydration suites in
 * `@ramonda/core` all run under jsdom, and core cannot host a `node`-environment test that imports
 * its own source (`vite.config.ts` defines `__DEV__` as an expression, which esbuild's `define`
 * refuses).
 *
 * One `window.` added to the record path would pass every suite in the repository and break every
 * SSR consumer, in development, which is the only place diagnostics exist at all.
 */
import { Component, Hook, renderToString, state, type RamondaNode } from "@ramonda/core";

class Store extends Hook<{ seed: number }> {
  @state value = this.props.seed;
}

export class Faulty extends Component {
  /**
   * A function in `@state`: state travels to the client as JSON, so this cannot. Raises two codes —
   * one from the state write and one from the serialize walk.
   */
  @state formatter = () => "x";

  /**
   * Labelled, so the script can assert the label is nowhere in the hydration blob. It is a
   * development-only devtools name, not application state, and a blob that carried it would mean the
   * two sides disagree about what to restore.
   */
  private labelled = this.use(Store, { seed: 1 }, { label: "signup" });

  render(): RamondaNode {
    // `class` where `className` is read: the styling never applies, and it is reported.
    return <p class="lead">{this.labelled.value}</p>;
  }
}

/**
 * Renders it, from INSIDE this bundle.
 *
 * The render has to happen here rather than in the script, so it runs through the same `renderToString`
 * the bundle carries — one `__DEV__`, one copy of core, one diagnostics sink. A script importing core
 * separately would be measuring a second instance.
 */
export function render(): Promise<string> {
  return renderToString(<Faulty />);
}
