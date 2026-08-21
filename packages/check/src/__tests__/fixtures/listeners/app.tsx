import { Component, Host, bootstrap, created, destroyed, state } from "../framework";

const RESIZE = "resize";

declare const signal: { addEventListener(kind: string, run: () => void, options?: unknown): void };

/** Module scope: it lives as long as the module, and there is nothing to clean up. */
window.addEventListener("online", () => {});

/** The fault, written where the rule looks. */
@Host("div")
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
    return <div>{this.n}</div>;
  }
}

/** The same event name, one hop away. */
@Host("div")
class LeaksThroughAName extends Component {
  @created
  start() {
    window.addEventListener(RESIZE, () => {});
  }

  render() {
    return <div>named</div>;
  }
}

/** Once per PASS rather than once per mount — measured at 6 listeners over 6 renders. */
@Host("div")
class LeaksPerRender extends Component {
  render() {
    window.addEventListener("scroll", () => {});
    return <div>per render</div>;
  }
}

/**
 * Removed by hand, and still reported — the decorator was the answer.
 *
 * This is the pair `interval-with-no-cleanup` accepts for a timer, and a listener is not a timer:
 * `@onWindow` exists and does both halves. Outside a dev guard there is nothing this arrangement
 * buys.
 */
@Host("div")
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
    return <div>paired</div>;
  }
}

/** `@onWindow` takes the same options, so closing the hatch is not an answer to this either. */
@Host("div")
class ClosesItself extends Component {
  controller = { signal: {} };

  @created
  start() {
    window.addEventListener("load", () => {}, { once: true });
    document.addEventListener("visibilitychange", () => {}, { signal: this.controller.signal });
  }

  render() {
    return <div>closes itself</div>;
  }
}

/** An `AbortSignal` dies with the request, and an element dies with the element. */
@Host("div")
class NotAGlobal extends Component {
  box = { addEventListener(kind: string, run: () => void) {} };

  @created
  start() {
    signal.addEventListener("abort", () => {});
    this.box.addEventListener("click", () => {});
  }

  render() {
    return <div>not a global</div>;
  }
}

/** An unreadable event name costs nothing here — the decorator was the answer whatever it is. */
@Host("div")
class UnreadableEvent extends Component {
  kind = "resize";

  @created
  start() {
    window.addEventListener(this.kind, () => {});
  }

  render() {
    return <div>unreadable</div>;
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

@Host("div")
class Concrete extends AbstractAdds {
  render() {
    return <div>concrete</div>;
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
@Host("div")
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
    return <div>dev only</div>;
  }
}

/** ✗ The same, with the hatch left open — a leak, in development. */
@Host("div")
class DevOnlyAndLeaking extends Component {
  @created
  start() {
    if (__DEV__ && this.ready) {
      document.addEventListener("ramonda:panel-gone", () => {});
    }
  }

  ready = true;

  render() {
    return <div>dev only, leaking</div>;
  }
}

/** A guard is not a guard when it is an `||`, or when the code is in the `else`. */
@Host("div")
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
    return <div>not guarded</div>;
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
bootstrap(<DevOnlyAndLeaking />, null);
bootstrap(<NotReallyGuarded />, null);
