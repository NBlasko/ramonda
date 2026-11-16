import { Component, bootstrap } from "@ramonda/core";

class Shown extends Component {
  render() {
    return <p>shown</p>;
  }
}

/** A dependency compiled from source, with a root of its own through a helper. */
const shell = () => <Shown />;
export function start(): void {
  bootstrap(shell(), document.body);
}
