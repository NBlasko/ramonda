import { Component } from "@ramonda/core";

/** A file that declares its own `Object`: the call is not the platform's, and is not reported. */
const Object = { keys: (value: unknown) => value };

class Cell extends Component<{ conf: unknown }> {
  render() {
    return <i />;
  }
}

export class Shadowed extends Component {
  conf = { dense: true };
  render() {
    return <Cell conf={Object.keys(this.conf)} />;
  }
}
