import { Component, bootstrap, created, mounted, created as onCreate } from "@ramonda/core";
import { created as ourOwn } from "./own";
import * as core from "@ramonda/core";

declare function fetchPosts(): Promise<string[]>;
declare function parseIt(raw: string): unknown;
declare const raw: string;

/** ✗ The plain fault, as the control. */
class Plain extends Component {
  @created()
  async load() {
    await fetchPosts();
  }
  render() {
    return null;
  }
}

/** ✗ The SAME fault through an aliased import of core's decorator. */
class Aliased extends Component {
  @onCreate()
  async load() {
    await fetchPosts();
  }
  render() {
    return null;
  }
}

/** ✓ An app's own `created`. Not a lifecycle, and none of this rule's business. */
class OwnDecorator extends Component {
  @ourOwn()
  async load() {
    await fetchPosts();
  }
  render() {
    return null;
  }
}

/** ✗ The same lifecycle reached through a NAMESPACE import. */
class ThroughANamespace extends Component {
  @core.created()
  async load() {
    await fetchPosts();
  }
  render() {
    return null;
  }
}

/** ✗ A `try` that has nothing to do with the await. The fetch is still unguarded. */
class UnrelatedTry extends Component {
  @mounted()
  async load() {
    try {
      parseIt(raw);
    } catch {
      // not about the fetch
    }
    await fetchPosts();
  }
  render() {
    return null;
  }
}

/** ✗ One await handled, a second one not. */
class OnlyOneHandled extends Component {
  @created()
  async load() {
    await fetchPosts().catch(() => []);
    await fetchPosts();
  }
  render() {
    return null;
  }
}

/** ✓ The await really is inside the try. */
class ProperlyGuarded extends Component {
  @created()
  async load() {
    try {
      await fetchPosts();
    } catch {
      // handled
    }
  }
  render() {
    return null;
  }
}

/** ✗ A `finally` catches nothing — it runs on the way PAST a rejection, it does not stop one. */
class TryWithOnlyFinally extends Component {
  @created()
  async load() {
    try {
      await fetchPosts();
    } finally {
      parseIt(raw);
    }
  }
  render() {
    return null;
  }
}

/** ✗ The await is in the `catch`, which its own `try` does not protect. */
class AwaitInTheCatch extends Component {
  @created()
  async load() {
    try {
      parseIt(raw);
    } catch {
      await fetchPosts();
    }
  }
  render() {
    return null;
  }
}

/** ✓ Handled on the promise itself. */
class HandledOnThePromise extends Component {
  @created()
  async load() {
    await fetchPosts().catch(() => []);
  }
  render() {
    return null;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <Plain />
        <Aliased />
        <OwnDecorator />
        <ThroughANamespace />
        <UnrelatedTry />
        <OnlyOneHandled />
        <TryWithOnlyFinally />
        <AwaitInTheCatch />
        <ProperlyGuarded />
        <HandledOnThePromise />
      </div>
    );
  }
}

bootstrap(<App />, null);
