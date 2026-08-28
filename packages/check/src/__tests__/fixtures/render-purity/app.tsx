import { Panel } from "./inherited";
import { Component, bootstrap, compute, list, memoized, mounted, state } from "@ramonda/core";
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

bootstrap(<OverridesIt />, null);
bootstrap(<OtherPaths />, null);
bootstrap(<ThroughSuper />, null);
