import { Component, bootstrap } from "@ramonda/core";
import { Themed } from "@acme/ui";
import { ThemeProvider } from "@acme/shared";

/**
 * The package is INSTALLED and the context it needs is COMPILED FROM SOURCE here.
 *
 * Two identities for one context is what breaks this: the app records its provider one way and the
 * fragment names the requirement another, and the two never meet — a build failing against correct
 * code, which is the one thing this tool cannot afford.
 */
class Covered extends Component {
  p = this.use(ThemeProvider);
  render() {
    return <Themed />;
  }
}

class Bare extends Component {
  render() {
    return <Themed />;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <Covered />
        <Bare />
      </div>
    );
  }
}

bootstrap(<App />, null);
