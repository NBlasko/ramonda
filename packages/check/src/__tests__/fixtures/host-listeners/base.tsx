import { Component } from "@ramonda/core";

/** A `@Host` on a BASE, which a subclass inherits — the tag is read from the constructor. */
export class Panel extends Component {
  render() {
    return (
      <section>
        <div />
      </section>
    );
  }
}
