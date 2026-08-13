import { Component } from "../framework";
import { Reader } from "./reader";

/** The other `Page`, with no provider — the same name and a different component. */
export class Page extends Component {
  render() {
    return <Reader />;
  }
}
