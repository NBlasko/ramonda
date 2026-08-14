import { Component, bootstrap } from "../framework";

declare const window: { location: { pathname: string } };

/**
 * The same read as the sibling fixture, in a project with no router.
 *
 * Nothing is reported here, and that is the point: without a router this is the only place the
 * answer lives, and a rule that reports the only thing a reader could have written is a rule people
 * switch off.
 */
class Where extends Component {
  render() {
    return <span>{window.location.pathname}</span>;
  }
}

class App extends Component {
  render() {
    return <Where />;
  }
}

bootstrap(<App />, null);
