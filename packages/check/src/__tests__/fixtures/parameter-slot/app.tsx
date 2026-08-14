import { Component, createContext, bootstrap } from "../framework";

const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

declare function __h(type: unknown, props: unknown, ...children: unknown[]): unknown;

/** A parameter used as a tag: the caller decides, exactly as a prop does. */
export function mountAny(type: unknown, children: unknown): unknown {
  return __h(type, null, children);
}

/** A parameter at DEPTH — the slot is a path, the same mechanism with a longer name. */
export function mountWrapped(options: { wrapper?: unknown }, node: unknown): unknown {
  return options.wrapper ? __h(options.wrapper, null, node) : node;
}

/** The same name behind a cast. */
export function mountCast(view: unknown): unknown {
  return __h(view as never, null);
}

/**
 * A CALL is not a parameter. Reading what `pick` returns is dataflow, which this resolver refuses
 * by decision, so this stays a hole and needs a written reason.
 */
declare function pick(x: unknown): unknown;
export function mountCalled(ui: unknown): unknown {
  // ramonda-check-ignore what a call returns cannot be read, and this fixture is about that line
  return __h(pick(ui), null);
}

/** A local binding is not a parameter either: what it holds cannot be read where it is declared. */
declare const registry: Record<string, unknown>;
export function mountLocal(key: string): unknown {
  const chosen = registry[key];
  // ramonda-check-ignore a local binding holds whatever ran, and this fixture is about that line
  return __h(chosen, null);
}

/**
 * A component whose HOOK comes from a parameter stays OPAQUE, and that is the half of the exemption
 * worth pinning: the site goes silent, it does not become transparent.
 *
 * `Host` may or may not be publishing Theme — only its caller knows — so `Quiet` beneath it must
 * not be reported either way. `Loud`, mounted where nothing could be providing, still is.
 */
class Host extends Component {
  attach(hook: unknown): unknown {
    return this.use(hook as never);
  }
  render() {
    return <Quiet />;
  }
}

class Quiet extends Component {
  ctx = this.use(ThemeConsumer);
  render() {
    return <span>quiet</span>;
  }
}

class Loud extends Component {
  ctx = this.use(ThemeConsumer);
  render() {
    return <span>loud</span>;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <Host />
        <Loud />
      </div>
    );
  }
}

bootstrap(<App />, null);
export { ThemeProvider };
