import { Component, bootstrap } from "@ramonda/core";
import "./vendor/other";

/**
 * The package's OWN source, and it is clean: every tag names a class this can follow, and nothing
 * needed an exemption written beside it.
 */
class Panel extends Component {
  render() {
    return <div>panel</div>;
  }
}

class App extends Component {
  render() {
    return <Panel />;
  }
}

bootstrap(<App />, null);
