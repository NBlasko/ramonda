import { Component, bootstrap, mounted } from "@ramonda/core";

declare const __DEV__: boolean;
declare function onKey(e: unknown): void;

/** ✓ The plain guard, as the control. */
class GuardedByIf extends Component {
  @mounted()
  start() {
    if (__DEV__) window.addEventListener("keydown", onKey);
  }
  render() {
    return null;
  }
}

/** ✓ The `&&` spelling, which `insideADevGuard` already takes. */
class GuardedByAnd extends Component {
  @mounted()
  start() {
    __DEV__ && window.addEventListener("keydown", onKey);
  }
  render() {
    return null;
  }
}

/** ✓ An EARLY RETURN, which is the same guard written the other way up. */
class GuardedByEarlyReturn extends Component {
  @mounted()
  start() {
    if (!__DEV__) return;
    window.addEventListener("keydown", onKey);
  }
  render() {
    return null;
  }
}

/** ✓ The bundler's own DEV flag, which is the same fact with another name. */
class GuardedByImportMeta extends Component {
  @mounted()
  start() {
    if (import.meta.env.DEV) window.addEventListener("keydown", onKey);
  }
  render() {
    return null;
  }
}

/** ✗ Not guarded at all — what says the rule is still on. */
class NotGuarded extends Component {
  @mounted()
  start() {
    window.addEventListener("keydown", onKey);
  }
  render() {
    return null;
  }
}

/** ✗ The `else` of a dev guard is production. */
class InTheElse extends Component {
  @mounted()
  start() {
    if (__DEV__) onKey(1);
    else window.addEventListener("keydown", onKey);
  }
  render() {
    return null;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <GuardedByIf />
        <GuardedByAnd />
        <GuardedByEarlyReturn />
        <GuardedByImportMeta />
        <NotGuarded />
        <InTheElse />
      </div>
    );
  }
}

bootstrap(<App />, null);
