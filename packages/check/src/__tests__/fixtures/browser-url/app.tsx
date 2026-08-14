import { Component, bootstrap } from "../framework";
// The import is what says this project HAS a router; without one, `location` is the only place the
// answer lives and none of this would be reported.
import { Router } from "@ramonda/router";

declare const window: {
  location: { pathname: string; hash: string; search: string; origin: string };
};

/** Asks the browser where the router already knows. Every read here is reported. */
class Astray extends Component {
  route = this.use(Router);
  render() {
    const where = window.location.pathname;
    const anchor = location.hash;
    const query = window.location.search;
    // No member of the router answers this one, so the report names no replacement rather than
    // inventing one.
    const origin = window.location.origin;
    return <span>{`${where}${anchor}${query}${origin}`}</span>;
  }
}

/**
 * A LOCAL called `location` is not the global, and telling them apart costs no type: the program is
 * built with no lib and no `@types`, so the browser's own name resolves to nothing while this one
 * resolves right here.
 */
class Careful extends Component {
  render() {
    const location = { hash: "#none" };
    return <span>{location.hash}</span>;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <Astray />
        <Careful />
      </div>
    );
  }
}

bootstrap(<App />, null);
