import { Component } from "@ramonda/core";

/** Mounted by the exported component below, which an app enters through what this publishes. */
class Inner extends Component {
  render() {
    return <p>inner</p>;
  }
}

export class Outer extends Component {
  render() {
    return <Inner />;
  }
}
