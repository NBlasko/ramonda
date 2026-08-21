import { Component, Host, bootstrap, compute, state } from "../framework";

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
 * A callback handed to a call that runs it LATER.
 *
 * None of these runs during the render: `setTimeout` fires after it, a `then` runs on a
 * microtask after it, and a listener runs when somebody clicks. Writing state in any of them is
 * the ordinary way to do it.
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

bootstrap(<Direct />, null);
bootstrap(<Deferred />, null);
bootstrap(<Immediate />, null);
bootstrap(<ArrowRender />, null);
bootstrap(<ComputedMethod />, null);
bootstrap(<HostProps />, null);
