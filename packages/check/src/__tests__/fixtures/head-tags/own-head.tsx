import { Component, Hook } from "@ramonda/core";

/**
 * An app's own hook called `Head`. Nothing about it is the framework's, and the collisions below
 * are not this rule's business — identity is the import, not the name.
 */
export class Head extends Hook {}

export class OwnHead extends Component {
  head = this.use(Head, {
    meta: [
      { name: "robots", content: "index" },
      { name: "robots", content: "noindex" },
    ],
  });
  render() {
    return <p>not ours</p>;
  }
}
