import { Component, __h, bootstrap, createContext, createRoutes } from "@ramonda/core";

const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

class Counter extends Component {
  ctx = this.use(ThemeConsumer);
  render() {
    return <span>count</span>;
  }
}

class Clock extends Component {
  render() {
    return <span>clock</span>;
  }
}

class Panel extends Component {
  render() {
    return <section>panel</section>;
  }
}

/** A registry written as a literal, with shorthand entries — the shape a demo index has. */
const demos = { Counter, Clock };

class Stage extends Component {
  render() {
    // The component is picked at run time, so what MAY mount is the union of the map's values.
    const chosen = demos[this.props.name];
    // And a tag chosen between two ELEMENTS is not a component at all.
    const tag = this.props.inline ? "span" : "div";
    return __h(tag, null, __h(chosen, null));
  }
}

/**
 * A function that mounts through the factory and writes no tag at all.
 *
 * Looking for tags alone made it no helper, so its body was never walked — and it is HANDED to
 * something rather than called, so nothing reached it either.
 */
function toNode(name: string): unknown {
  return __h(demos[name], null);
}

class Content extends Component {
  render() {
    return <div>{["Counter", "Clock"].map(toNode)}</div>;
  }
}

/** The factory called with a component named outright, which is how a generated page renders. */
class Page extends Component {
  render() {
    return __h(Panel, { title: "x" });
  }
}

/** A table built by a LOOP, through the factory — the shape the documentation site has. */
const table: Record<string, unknown> = {};
for (const path of ["/a", "/b"]) {
  table[path] = __h(Page, { path });
}
const routes = createRoutes(table);

declare class RouteOutlet extends Component {
  props: { routes: unknown };
}

class App extends Component {
  render() {
    return (
      <div>
        <RouteOutlet routes={routes} />
        <Stage name="Counter" inline={false} />
        <Content />
      </div>
    );
  }
}

bootstrap(<App />, null);
