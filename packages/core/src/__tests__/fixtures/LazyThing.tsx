import { Component } from "../../base/Component";

/**
 * A real module for a real `import()` to reach, so the cache-key tests can use the
 * shape apps actually write — `() => import("./LazyThing")` — rather than a stand-in.
 */
export default class LazyThing extends Component {
  render() {
    return (
      <i>
        <span>thing</span>
      </i>
    );
  }
}
