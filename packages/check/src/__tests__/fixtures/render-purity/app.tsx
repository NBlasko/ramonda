import { Panel } from "./inherited";
import { Component, Host, bootstrap, compute, list, memoized, mounted, state } from "../framework";
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
@Host("div")
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
    );
  }
}

@Host("div")
class Untimed extends Component {
  @state label = "";

  /** REPORTED via `render → decorate → stampedLabel` — a clock in another file. */
  decorate(label: string) {
    return stampedLabel(label);
  }

  render() {
    return (
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
@Host("div")
class InheritsIt extends Panel {
  render() {
    this.count();
    return <div>{this.hits}</div>;
  }
}

bootstrap(<InheritsIt />, null);
