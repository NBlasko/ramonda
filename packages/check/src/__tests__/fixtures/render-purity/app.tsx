import { Panel } from "./inherited";
import { Component, Hook, bootstrap, compute, list, memoized, mounted, state } from "@ramonda/core";
import { plainLabel, stampedLabel } from "./format";

declare const items: { id: string; label: string }[];
declare const when: number;

/**
 * Everything the render walk must find, beside everything it must not.
 *
 * The pairs are the point: a write in a helper the render CALLS beside a write in a handler the
 * render HANDS OVER, and a clock three names away beside a deterministic utility reached the same
 * way. A rule that gets one of each pair wrong is not stricter, it is broken.
 */
class Impure extends Component {
  @state n = 0;
  @state label = "";
  /** Not state — a write to it is not the fault this rule is about. */
  cache = 0;

  /** REPORTED via `render → stamp` — a write in a method the render calls. */
  stamp() {
    this.label = "now";
  }

  /** REPORTED via the compute entry point, not via render. */
  @compute get total() {
    this.n = 1;
    return this.n;
  }

  /** NOT reported: a handler factory. What it returns runs on a click. */
  @memoized
  pick(id: string) {
    return () => {
      this.n += 1;
      return id;
    };
  }

  /** NOT reported: never reached from a render. */
  @mounted
  start() {
    this.n = 0;
  }

  render() {
    // REPORTED — written in the body itself.
    this.n = 1;
    // NOT reported — `cache` is not state.
    this.cache = 2;
    this.stamp();
    return (
      <div>
        <div>
          {/* NOT reported: an arrow handed to an attribute runs on the event. */}
          <button type="button" onclick={() => (this.n += 1)}>
            up
          </button>
          {/* NOT reported: the factory is called now, but its RESULT runs on the click. */}
          <button type="button" onclick={this.pick("a")}>
            pick
          </button>
          {/* REPORTED — a callback passed to `list` runs during the render. */}
          <ul>
            {list(items, (item) => {
              this.n += 1;
              return <li key={item.id}>{item.label}</li>;
            })}
          </ul>
          <p>{this.total}</p>
        </div>
      </div>
    );
  }
}

class Untimed extends Component {
  @state label = "";

  /** REPORTED via `render → decorate → stampedLabel` — a clock in another file. */
  decorate(label: string) {
    return stampedLabel(label);
  }

  render() {
    return (
      <div>
        <div>
          {/* REPORTED — written in the body. */}
          <span>{Math.random()}</span>
          {/* REPORTED — the platform's own random id, and its random bytes: the runtime's RMD021
              names both, and the rule knew only `Math.random()`. */}
          <span>{crypto.randomUUID()}</span>
          <span>{crypto.getRandomValues(new Uint8Array(1))[0]}</span>
          {/* REPORTED — the argument-less form asks what time it is. */}
          <span>{new Date().toISOString()}</span>
          {/* NOT reported — parsing a timestamp is deterministic. */}
          <span>{new Date(when).toISOString()}</span>
          {/* NOT reported — deterministic, and reached the same way as the clock above. */}
          <span>{plainLabel(this.label)}</span>
          <span>{this.decorate(this.label)}</span>
        </div>
      </div>
    );
  }
}

bootstrap(<Impure />, null);
bootstrap(<Untimed />, null);

/**
 * REPORTED — the write is on the base, and so is the field.
 *
 * Written last so it cannot move any other case's line numbers, and separate from every other class
 * here because it is the one that needs a second file to be the fault at all.
 */
class InheritsIt extends Panel {
  render() {
    this.count();
    return (
      <div>
        <div>{this.hits}</div>
      </div>
    );
  }
}

bootstrap(<InheritsIt />, null);

/**
 * The shapes a render can reach that are NOT a `this.method()` call.
 *
 * Each one is a plant: the CLAIM is "reached from a render, by any path", so every one of these
 * either has to be reported or has to be a decision written down.
 */
class OtherPaths extends Component {
  @state n = 0;

  /** An arrow FIELD, which is a property rather than a method. */
  viaArrowField = () => {
    this.n = Date.now();
  };

  /** A plain getter, read rather than called. */
  get viaGetter(): number {
    return Date.now();
  }

  /** Reached through `super`, so the callee is not `this`. */
  viaSuper() {
    return 0;
  }

  /** A static, called on the class rather than on the instance. */
  static viaStatic(): number {
    return Date.now();
  }

  render() {
    this.viaArrowField();
    OtherPaths.viaStatic();
    return (
      <div>
        <div>
          {this.viaGetter}
          {this.viaSuper()}
        </div>
      </div>
    );
  }
}

/** `super.method()` needs a base with the method on it. */
class DeepBase extends Component {
  stampFromBase() {
    return Date.now();
  }
  render() {
    return <div />;
  }
}

class ThroughSuper extends DeepBase {
  render() {
    return (
      <div>
        <p>{super.stampFromBase()}</p>
      </div>
    );
  }
}

/**
 * NOT reported: a subclass OVERRIDING a base's method. Only the subclass's body runs, so the base's
 * clock read is never reached — and walking both bodies reported it until the lookup started taking
 * the nearest declaration, which is how JS resolves a method.
 */
class OverriddenBase extends Component {
  stamp() {
    return Date.now();
  }
  render() {
    return <span />;
  }
}

class OverridesIt extends OverriddenBase {
  stamp() {
    return 0;
  }
  render() {
    return (
      <div>
        <p>{this.stamp()}</p>
      </div>
    );
  }
}

/**
 * A hook's props callback is cached on the signals it reads, so a random number or a clock read there
 * is frozen into the props until something unrelated runs the callback again — and then it jumps. The
 * runtime reports the random half as RMD021, measured; this rule read only renders.
 */
class Seeded extends Hook<{ seed: unknown; at?: unknown; later?: unknown }> {}
class InTheCallback extends Component {
  @state tick = 0;
  // REPORTED, both — read while the callback builds the props, in a callback that runs again.
  seeded = this.use(Seeded, (self: InTheCallback) => ({ seed: Math.random(), at: Date.now(), later: self.tick }));
  // REPORTED — a random number differs between two calls in one tick, so the runtime reports it
  // (RMD021) even where nothing can run the callback again. Measured.
  random = this.use(Seeded, () => ({ seed: Math.random() }));
  // NOT reported — a clock read in a callback that reads nothing is taken once, at mount, and kept:
  // what such a callback is for. The runtime says nothing either: both calls fall in one millisecond.
  once = this.use(Seeded, () => ({ seed: 1, at: Date.now() }));
  // NOT reported — handed over, and run later by the hook rather than by the callback.
  later = this.use(Seeded, () => ({ seed: 1, later: () => Date.now() }));
  render() {
    return <i />;
  }
}

bootstrap(<OverridesIt />, null);
bootstrap(<InTheCallback />, null);
bootstrap(<OtherPaths />, null);
bootstrap(<ThroughSuper />, null);
