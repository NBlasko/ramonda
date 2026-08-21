import { Component, Host, bootstrap, compute, state } from "@ramonda/core";

declare const rows: string[];

/** Written where the rule looks: a write during the render, and a clock read. */
@Host("div")
class Direct extends Component {
  @state n = 0;

  render() {
    this.n = 1;
    return <div>{Date.now()}</div>;
  }
}

/**
 * A render that ARMS a deferred write, four ways — every one of them reported.
 *
 * The write does not happen during the render, which is the argument for leaving these alone, and
 * it is the wrong argument. Measured against the real runtime: `setTimeout(() => this.n += 1, 0)`
 * armed from a render and guarded to stop at 50 renders **51 times**, and unguarded it does not
 * stop; `addEventListener` in a render registered **6 listeners over 6 renders**, none removed.
 *
 * A render is an answer to a question. Arming an effect from it happens once per time the question
 * is asked, and the framework asks whenever it likes.
 */
@Host("div")
class Deferred extends Component {
  @state n = 0;

  render() {
    setTimeout(() => {
      this.n = 1;
    }, 0);
    Promise.resolve().then(() => {
      this.n = 2;
    });
    queueMicrotask(() => {
      this.n = 3;
    });
    window.addEventListener("resize", () => {
      this.n = 4;
    });
    return <div>{this.n}</div>;
  }
}

/** A callback that really does run now — the row builder. */
@Host("div")
class Immediate extends Component {
  @state n = 0;

  render() {
    return <div>{rows.map(() => (this.n = 1))}</div>;
  }
}

/** `render` written as an arrow FIELD, which is a property rather than a method. */
@Host("div")
class ArrowRender extends Component {
  @state n = 0;

  render = () => {
    this.n = 1;
    return <div>{Date.now()}</div>;
  };
}

/** A `@compute` written as a METHOD, which core makes callable. */
@Host("div")
class ComputedMethod extends Component {
  @state n = 0;

  @compute
  stamp() {
    return Date.now();
  }

  render() {
    return <div>{this.stamp()}</div>;
  }
}

/** The `@Host` props callback, which runs during the render and is in no member body. */
@Host("div", () => ({ id: `x-${Date.now()}` }))
class HostProps extends Component {
  render() {
    return <div>host</div>;
  }
}

/** The TAG callback runs on every render too — and `@Host` here has no second argument at all. */
@Host((self: TagFromProps) => `x-${Date.now()}`)
class TagFromProps extends Component {
  render() {
    return <div>tag</div>;
  }
}

bootstrap(<Direct />, null);
bootstrap(<TagFromProps />, null);
bootstrap(<Deferred />, null);
bootstrap(<Immediate />, null);
bootstrap(<ArrowRender />, null);
bootstrap(<ComputedMethod />, null);
bootstrap(<HostProps />, null);
