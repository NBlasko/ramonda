import { Component, bootstrap, created, mounted } from "@ramonda/core";
import { fromHelper } from "./helper";

/** ✓ The standard safe pattern: `process` is only touched when it exists. */
export class Guarded extends Component {
  render() {
    const region = typeof process !== "undefined" ? process.env.REGION : "";
    return <p>{region}</p>;
  }
}

/** ✓ The `&&` spelling of the same guard. */
export class GuardedAnd extends Component {
  render() {
    const region = typeof process !== "undefined" && process.env.REGION;
    return <p>{String(region)}</p>;
  }
}

/** ✓ The bundler's own SSR flag, which is `false` in the browser bundle. */
export class GuardedBySsr extends Component {
  render() {
    if (import.meta.env.SSR) return <p>{process.env.DATABASE_URL}</p>;
    return <p>client</p>;
  }
}

/** ✗ A read in a module-level helper the render calls. The browser gets there just the same. */
export class ThroughAHelper extends Component {
  render() {
    return <p>{fromHelper()}</p>;
  }
}

/** ✗ A read inside a click handler, which is the browser by definition. */
export class InAHandler extends Component {
  render() {
    return <button onclick={() => console.log(process.env.API_KEY)}>go</button>;
  }
}

/** A base whose SHARED member reads it — the subclass inherits the fault. */
export class SharedBase extends Component {
  @mounted()
  warm() {
    console.log(process.env.DATABASE_URL);
  }
  render() {
    return null;
  }
}

/** ✗ Inherits `warm`, which is shared. */
export class InheritsIt extends SharedBase {}

/** ✓ The base says server-only; the subclass inherits that too. */
export class ServerBase extends Component {
  @created({ env: "server" })
  read() {
    console.log(process.env.DATABASE_URL);
  }
  render() {
    return null;
  }
}

export class InheritsTheMarking extends ServerBase {}

@created({ env: "server" })
class Unused extends Component {
  render() {
    return null;
  }
}

/** ✓ The other standard spelling of "this is the server". */
export class GuardedByNoWindow extends Component {
  render() {
    if (typeof window === "undefined") return <p>{process.env.DATABASE_URL}</p>;
    return <p>client</p>;
  }
}

/** ✓ An early return, which is the same guard written the other way up. */
export class GuardedByEarlyReturn extends Component {
  render() {
    if (typeof process === "undefined") return <p>client</p>;
    return <p>{process.env.DATABASE_URL}</p>;
  }
}

/** ✓ The same question asked of the browser globals: guarded, so it does not crash on the server. */
export class GuardedWindow extends Component {
  render() {
    const path = typeof window === "undefined" ? "/" : window.location.pathname;
    return <p>{path}</p>;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <Guarded />
        <GuardedAnd />
        <GuardedBySsr />
        <ThroughAHelper />
        <InAHandler />
        <InheritsIt />
        <InheritsTheMarking />
        <GuardedByNoWindow />
        <GuardedByEarlyReturn />
        <GuardedWindow />
        <Unused />
      </div>
    );
  }
}

bootstrap(<App />, null);
