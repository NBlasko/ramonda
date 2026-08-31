import { AsyncLoad, Component } from "@ramonda/core";

/**
 * Silent: identical text in ONE directory is one module, which is what the runtime proves before it
 * reports — it fires only when the two load DIFFERENT things.
 *
 * `./Widget` rather than `./Panel`, and that is the point of the file: written as `./Panel` these
 * two would share their text with `one/` and `two/` and be part of THAT collision, so the case they
 * exist to test — a same-directory pair — would never have been asked.
 */
export class SameA extends Component {
  render() {
    return <AsyncLoad lazy={() => import("./Widget")} onLoading={null} errorFallback={null} />;
  }
}

export class SameB extends Component {
  render() {
    return <AsyncLoad lazy={() => import("./Widget")} onLoading={null} errorFallback={null} />;
  }
}
