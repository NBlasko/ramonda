import { Component, bootstrap, catchError, createContext, Host, ShouldUpdateOnPropsChange } from "../framework";

/**
 * Written the way an app is written: real JSX, and the AUTOMATIC runtime that a real
 * `tsconfig.json` configures (`jsx: "react-jsx"` + `jsxImportSource`). Every other fixture here
 * uses the classic runtime with `jsxFactory: "h"` — a factory the framework no longer exports —
 * so this is also the one place the analyzer is proved to work against the configuration real
 * projects have.
 *
 * The context pair is here for that reason and no other: finding it needs the analyzer to walk the
 * JSX tree, so a consumer reported with the right PATH is the proof that the walk happened.
 */
const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

// Two answers to "who handles an error from below?" — the first never runs.
@Host("div")
class Twice extends Component {
  @catchError logIt() {}
  @catchError showFallback() {}
  render() {
    return <i />;
  }
}

// Two class decorators of the same single-use kind.
@ShouldUpdateOnPropsChange(() => true)
@ShouldUpdateOnPropsChange(() => false)
@Host("div")
class GatedTwice extends Component {
  render() {
    return <i />;
  }
}

// The BASE declares one; the subclass overrides it. Not a duplicate.
@Host("div")
class Base extends Component {
  @catchError handle() {}
  render() {
    return <i />;
  }
}

@Host("div")
class Sub extends Base {
  @catchError ownHandle() {}
}

// One of each: silent.
@ShouldUpdateOnPropsChange(() => true)
@Host("div")
class Fine extends Component {
  @catchError handle() {}
  render() {
    return <i />;
  }
}

// Reads the context; nothing above it provides one.
class Reader extends Component {
  theme = this.use(ThemeConsumer);
  render() {
    return <span />;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <Twice />
        <GatedTwice />
        <Sub />
        <Fine />
        <Reader />
      </div>
    );
  }
}

export { ThemeProvider };

bootstrap(<App />, null);
