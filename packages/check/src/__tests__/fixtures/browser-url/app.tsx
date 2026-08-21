import { Component, bootstrap } from "@ramonda/core";
import { currentPath } from "./where";
// The import is what says this project HAS a router; without one, `location` is the only place the
// answer lives and none of this would be reported.
import { Router } from "@ramonda/router";

/**
 * NOTHING is declared for `window`, `self` or `location`, and that is the fixture's point.
 *
 * The analyzer builds its program with `noLib` and no `@types`, so the browser's own names have no
 * declaration to find — which is exactly how a rule tells one from a local of the same name. A stub
 * here would give them one, and every read below would read as somebody's own field.
 */

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

/** The three spellings beside `window.` — `self`, a destructure, and a bracket. */
class OtherSpellings extends Component {
  route = this.use(Router);
  render() {
    const onSelf = self.location.pathname;
    const { pathname } = window.location;
    const bracketed = window.location["hash"];
    return <span>{`${onSelf}${pathname}${bracketed}`}</span>;
  }
}

/**
 * ✓ A LOCAL called `self`, which is the commonest of the four to be one.
 *
 * `const self = this` is an ordinary line, and `(self) => …` is the framework's OWN convention for
 * a `@Host` props callback. Both read a component's own field and neither is the global.
 */
class SelfIsALocal extends Component {
  route = this.use(Router);
  location = { pathname: "/mine" };
  render() {
    const self = this;
    return <span>{self.location.pathname}</span>;
  }
}

/** ✗ An AMBIENT `declare const self` is the author writing down what the platform provides. */
declare const self: { location: { pathname: string } };

@Host("div")
class AmbientSelf extends Component {
  route = this.use(Router);
  render() {
    return <span>{self.location.pathname}</span>;
  }
}

/** ✓ A PARAMETER called `window` is a name of their own, however it is spelled. */
@Host("div")
class WindowIsAParameter extends Component {
  route = this.use(Router);

  read(window: { location: { pathname: string } }) {
    return window.location.pathname;
  }

  render() {
    return <span>{this.read({ location: { pathname: "/mine" } })}</span>;
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
