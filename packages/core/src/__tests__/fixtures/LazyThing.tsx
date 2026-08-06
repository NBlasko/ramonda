import { Component } from "../../base/Component";
import { Host } from "../../base/decorators";

/**
 * A real module for a real `import()` to reach, so the cache-key tests can use the
 * shape apps actually write — `() => import("./LazyThing")` — rather than a stand-in.
 */
@Host("i")
export default class LazyThing extends Component {
  render() {
    return <span>thing</span>;
  }
}
