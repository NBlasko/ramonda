import { Component, createContext, bootstrap } from "@ramonda/core";

const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

/**
 * Five classes, two of which are components — the counting this fixture exists to pin.
 *
 * `ThemeProvider` is declared and never mounted on purpose: `Deep` consumes the context with
 * nothing above it, which is the report that proves a subclass is still walked as a component.
 */

// ✓ not components: no class in either chain is `Component` or `Hook`.
class MyError extends Error {}
class Plain {
  helper(x: number) {
    return x * 2;
  }
}
class Widget extends Plain {}

// ✗ a component, and a component's subclass — the chain has to keep both.
class Base extends Component {
  render() {
    return <span>base</span>;
  }
}
class Deep extends Base {
  ctx = this.use(ThemeConsumer);
  render() {
    return <span>deep</span>;
  }
}

class App extends Component {
  render() {
    return <Deep />;
  }
}

bootstrap(<App />, null);

// A mixin's heritage clause is a CALL, so there is no symbol to follow and it reads as
// "not a component" — the shape the resolver is decided not to see.
declare function withTheme<T>(base: T): T;
class Panel extends withTheme(Component) {}

export { MyError, Widget, Base, Deep, App, Panel, ThemeProvider };
