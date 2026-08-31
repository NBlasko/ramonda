import { AsyncLoad, Component } from "@ramonda/core";

/** REPORTED — the identical text in `two/Uses.tsx` resolves to a DIFFERENT `./Panel`. */
export class UsesOne extends Component {
  render() {
    return <AsyncLoad lazy={() => import("./Panel")} onLoading={null} errorFallback={null} />;
  }
}

/** REPORTED — the same fault behind a name, which is what the docs now recommend writing. */
const loadPanel = () => import("./Panel");

export class UsesOneNamed extends Component {
  render() {
    return <AsyncLoad lazy={loadPanel} onLoading={null} errorFallback={null} />;
  }
}

/** Silent: an explicit `cacheKey` is the app's own claim about identity, and it is believed. */
export class UsesOneKeyed extends Component {
  render() {
    return <AsyncLoad cacheKey="one" lazy={() => import("./Panel")} onLoading={null} errorFallback={null} />;
  }
}

/** Silent: a spread may be carrying the `cacheKey` that settles it. */
declare const rest: Record<string, unknown>;

export class UsesOneSpread extends Component {
  render() {
    return <AsyncLoad {...rest} lazy={() => import("./Panel")} onLoading={null} errorFallback={null} />;
  }
}

/** Silent: a BARE specifier names one module wherever it is written. */
export class UsesOneBare extends Component {
  render() {
    return <AsyncLoad lazy={() => import("@ramonda/core")} onLoading={null} errorFallback={null} />;
  }
}
