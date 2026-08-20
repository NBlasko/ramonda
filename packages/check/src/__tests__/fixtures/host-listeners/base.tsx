import { Component, Host } from "../framework";

/** A `@Host` on a BASE, which a subclass inherits — the tag is read from the constructor. */
@Host("section")
export class Panel extends Component {
  render() {
    return <div />;
  }
}
