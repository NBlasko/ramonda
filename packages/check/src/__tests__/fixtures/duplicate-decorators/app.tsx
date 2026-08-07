import {
  Component,
  bootstrap,
  catchError,
  compute,
  createContext,
  Host,
  ShouldUpdateOnPropsChange,
  state,
} from "../framework";

/**
 * Written the way an app is written: real JSX, and the AUTOMATIC runtime a real `tsconfig.json`
 * configures (`jsx: "react-jsx"` + `jsxImportSource`).
 *
 * The context pair is here for one reason: finding it needs the analyzer to walk the JSX tree, so a
 * consumer reported with the right PATH is the proof that the walk happened — under this runtime,
 * which is the one every project has and the one nothing here used to exercise.
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

// The other fault: applying it twice changes nothing, so the advice differs. Measured in core — a
// doubled @state renders once per write with the right value, and @compute's body runs once for two
// reads. Nothing is displaced; the belief is simply wrong.
@Host("div")
class RedundantTwice extends Component {
  @state @state n = 1;
  @compute @compute get doubled() {
    return this.n * 2;
  }
  render() {
    return <i />;
  }
}

// What every component looks like: several fields, one @state each. Counting @state per CLASS reported
// this as "declares @state 3 times", which is why the redundant kind is counted per MEMBER.
@Host("div")
class ManyFields extends Component {
  @state a = 1;
  @state b = 2;
  @state c = 3;
  @compute get sum() {
    return this.a + this.b + this.c;
  }
  render() {
    return <i />;
  }
}

// `refuses`: two @Host THROW at class definition (RMD045) — two element names have no union, so there
// is no live declaration to point a reader at. Only analyzed here, never run.
@Host("div")
@Host("span")
class HostTwice extends Component {
  render() {
    return <i />;
  }
}

// `merges`: two @StableProps take BOTH effect (RMD046) — it names a set and already merges along the
// class chain, so the result is the union and nothing is lost.
@StableProps("a")
@StableProps("b")
class StableTwice extends Hook {
  @state x = 1;
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
        <RedundantTwice />
        <ManyFields />
        <Sub />
        <Fine />
        <Reader />
      </div>
    );
  }
}

export { ThemeProvider };

bootstrap(<App />, null);
