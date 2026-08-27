import { Component, Host, bootstrap, created, destroyed, state } from "@ramonda/core";

const RESIZE = "resize";

declare const signal: { addEventListener(kind: string, run: () => void, options?: unknown): void };

/** Module scope: it lives as long as the module, and there is nothing to clean up. */
window.addEventListener("online", () => {});

/** The fault, written where the rule looks. */
class Leaks extends Component {
  @state n = 0;

  @created
  start() {
    window.addEventListener("resize", this.onResize);
    document.addEventListener("keydown", this.onKey);
  }

  onResize() {}
  onKey() {}

  render() {
    return (
      <div>
        <div>{this.n}</div>
      </div>
    );
  }
}

/** The same event name, one hop away. */
class LeaksThroughAName extends Component {
  @created
  start() {
    window.addEventListener(RESIZE, () => {});
  }

  render() {
    return (
      <div>
        <div>named</div>
      </div>
    );
  }
}

/** Once per PASS rather than once per mount — measured at 6 listeners over 6 renders. */
class LeaksPerRender extends Component {
  render() {
    window.addEventListener("scroll", () => {});
    return (
      <div>
        <div>per render</div>
      </div>
    );
  }
}

/**
 * Removed by hand, and still reported — the decorator was the answer.
 *
 * This is the pair `interval-with-no-cleanup` accepts for a timer, and a listener is not a timer:
 * `@onWindow` exists and does both halves. Outside a dev guard there is nothing this arrangement
 * buys.
 */
class Paired extends Component {
  @created
  start() {
    window.addEventListener("resize", this.onResize);
  }

  onResize() {}

  @destroyed
  stop() {
    window.removeEventListener("resize", this.onResize);
  }

  render() {
    return (
      <div>
        <div>paired</div>
      </div>
    );
  }
}

/** `@onWindow` takes the same options, so closing the hatch is not an answer to this either. */
class ClosesItself extends Component {
  controller = { signal: {} };

  @created
  start() {
    window.addEventListener("load", () => {}, { once: true });
    document.addEventListener("visibilitychange", () => {}, { signal: this.controller.signal });
  }

  render() {
    return (
      <div>
        <div>closes itself</div>
      </div>
    );
  }
}

/** An `AbortSignal` dies with the request, and an element dies with the element. */
class NotAGlobal extends Component {
  box = { addEventListener(kind: string, run: () => void) {} };

  @created
  start() {
    signal.addEventListener("abort", () => {});
    this.box.addEventListener("click", () => {});
  }

  render() {
    return (
      <div>
        <div>not a global</div>
      </div>
    );
  }
}

/** An unreadable event name costs nothing here — the decorator was the answer whatever it is. */
class UnreadableEvent extends Component {
  kind = "resize";

  @created
  start() {
    window.addEventListener(this.kind, () => {});
  }

  render() {
    return (
      <div>
        <div>unreadable</div>
      </div>
    );
  }
}

/** Added on a base and removed in the subclass — reported at the base, where the call is written. */
class AddsOnABase extends Component {
  @created
  start() {
    window.addEventListener("pagehide", this.onHide);
  }

  onHide() {}

  render() {
    return <div>base</div>;
  }
}

@Host("div")
class RemovesInTheSubclass extends AddsOnABase {
  @destroyed
  stop() {
    window.removeEventListener("pagehide", this.onHide);
  }
}

/**
 * Abstract, and still reported: whether a decorator would have done the job does not depend on who
 * extends the class. Abstractness excuses the CLEANUP question, which is the dev-guard half below.
 */
abstract class AbstractAdds extends Component {
  @created
  start() {
    window.addEventListener("offline", () => {});
  }
}

class Concrete extends AbstractAdds {
  render() {
    return (
      <div>
        <div>concrete</div>
      </div>
    );
  }
}

// ── inside `if (__DEV__)`, where a decorator would ship and the raw call is right ─────────────

declare const __DEV__: boolean;

/**
 * The shape `@ramonda/query` and `@ramonda/form` both need, and both write.
 *
 * A decorator is code on the CLASS: no guard can remove it, so `@onWindow` here would attach in
 * production too, for an event nothing dispatches. The raw call is the right answer, and the only
 * question left is whether anything removes it. This one does.
 */
class DevOnlyAndPaired extends Component {
  @created
  start() {
    if (__DEV__) {
      window.addEventListener("ramonda:panel-request", this.republish);
    }
  }

  republish() {}

  @destroyed
  stop() {
    if (__DEV__) {
      window.removeEventListener("ramonda:panel-request", this.republish);
    }
  }

  render() {
    return (
      <div>
        <div>dev only</div>
      </div>
    );
  }
}

/**
 * ✓ Added on `window` and removed on `globalThis` — the same object under two names.
 *
 * This is the `@ramonda/query` / `@ramonda/form` devtools shape with one word changed, and it was
 * reported: the removal set was keyed on the spelling rather than on what the spelling names.
 */
class DevOnlyAcrossTwoNames extends Component {
  @created
  start() {
    if (__DEV__) {
      window.addEventListener("ramonda:panel-two", this.republish);
    }
  }

  republish() {}

  @destroyed
  stop() {
    if (__DEV__) {
      globalThis.removeEventListener("ramonda:panel-two", this.republish);
    }
  }

  render() {
    return (
      <div>
        <div>two names</div>
      </div>
    );
  }
}

/** ✗ The same, with the hatch left open — a leak, in development. */
class DevOnlyAndLeaking extends Component {
  @created
  start() {
    if (__DEV__ && this.ready) {
      document.addEventListener("ramonda:panel-gone", () => {});
    }
  }

  ready = true;

  render() {
    return (
      <div>
        <div>dev only, leaking</div>
      </div>
    );
  }
}

/**
 * ✓ The `&&` spelling of a dev guard, which the framework's own source writes thirteen times in
 * `packages/core` alone — and which was read as no guard at all, so the same code written the other
 * way was reported.
 */
class DevOnlyWithAnAnd extends Component {
  @created
  start() {
    __DEV__ && window.addEventListener("ramonda:panel-and", this.republish);
  }

  republish() {}

  @destroyed
  stop() {
    __DEV__ && window.removeEventListener("ramonda:panel-and", this.republish);
  }

  render() {
    return (
      <div>
        <div>and</div>
      </div>
    );
  }
}

/** ✓ And the ternary, which is the same claim once more. */
class DevOnlyWithATernary extends Component {
  @created
  start() {
    __DEV__ ? window.addEventListener("ramonda:panel-tern", this.republish) : undefined;
  }

  republish() {}

  @destroyed
  stop() {
    __DEV__ ? window.removeEventListener("ramonda:panel-tern", this.republish) : undefined;
  }

  render() {
    return (
      <div>
        <div>ternary</div>
      </div>
    );
  }
}

/** A guard is not a guard when it is an `||`, or when the code is in the `else`. */
class NotReallyGuarded extends Component {
  @created
  start() {
    if (__DEV__ || this.always) {
      window.addEventListener("beforeunload", () => {});
    }
    if (__DEV__) {
      this.always = true;
    } else {
      window.addEventListener("pagereveal", () => {});
    }
  }

  always = false;

  render() {
    return (
      <div>
        <div>not guarded</div>
      </div>
    );
  }
}

bootstrap(<Leaks />, null);
bootstrap(<LeaksThroughAName />, null);
bootstrap(<LeaksPerRender />, null);
bootstrap(<Paired />, null);
bootstrap(<ClosesItself />, null);
bootstrap(<NotAGlobal />, null);
bootstrap(<UnreadableEvent />, null);
bootstrap(<RemovesInTheSubclass />, null);
bootstrap(<Concrete />, null);
bootstrap(<DevOnlyAndPaired />, null);
bootstrap(<DevOnlyAcrossTwoNames />, null);
bootstrap(<DevOnlyAndLeaking />, null);
bootstrap(<DevOnlyWithAnAnd />, null);
bootstrap(<DevOnlyWithATernary />, null);
bootstrap(<NotReallyGuarded />, null);
