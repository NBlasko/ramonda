import { Component, bootstrap } from "../framework";
import { currentPath } from "./where";
// The import is what says this project HAS a router; without one, `location` is the only place the
// answer lives and none of this would be reported.
import { Router } from "@ramonda/router";

declare const window: {
  location: {
    pathname: string;
    hash: string;
    search: string;
    origin: string;
    href: string;
    assign(to: string): void;
    reload(): void;
  };
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

/**
 * Writing the URL and calling its methods. Neither is a READ, and neither is reported.
 *
 * A write is a different fault with a different answer, and `reload()` is the one thing the router
 * genuinely cannot replace — reported as "reads", they would be advice to do something impossible.
 */
class Leaving extends Component {
  go() {
    window.location.href = "https://example.com";
    window.location.assign("/x");
    window.location.reload();
  }
  render() {
    return <span>go</span>;
  }
}

/**
 * Two hops the claim may or may not cover: a helper on the class, and a utility in another file.
 * Planted to find out which of them the rule reaches.
 */
class ViaAHelper extends Component {
  private where(): string {
    return location.pathname;
  }
  render() {
    return <span>{this.where()}</span>;
  }
}

/**
 * NOT reported, and it is a decision: this report names a component and a line with nothing to say
 * how the two are connected, so following the import would name a component that did not write the
 * line, once per caller. See the rule's docstring.
 */
class ViaAnotherFile extends Component {
  render() {
    return <span>{currentPath()}</span>;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <Astray />
        <Careful />
        <Leaving />
        <ViaAHelper />
        <ViaAnotherFile />
      </div>
    );
  }
}

bootstrap(<App />, null);
