import { Component, compute, memoized, state } from "@ramonda/core";

/** Reported: one parameter, and its cache is keyed by nothing. */
export class OneParameter extends Component {
  @state factor = 2;
  @compute times(n: number) {
    return n * this.factor;
  }
  render() {
    return <div />;
  }
}

/** Reported, and the count says the writer meant to call it. */
export class TwoParameters extends Component {
  @state factor = 2;
  @compute between(low: number, high: number) {
    return low + high + this.factor;
  }
  render() {
    return <div />;
  }
}

/** Silent: a getter cannot declare one. */
export class AGetter extends Component {
  @state factor = 2;
  @compute get doubled() {
    return this.factor * 2;
  }
  render() {
    return <div />;
  }
}

/** Silent: a method with none is the other legitimate form — read as `this.tripled()`. */
export class AMethod extends Component {
  @state factor = 2;
  @compute tripled() {
    return this.factor * 3;
  }
  render() {
    return <div />;
  }
}

/** Silent: `@memoized` is the decorator keyed BY arguments, which is the advice this rule gives. */
export class Memoized extends Component {
  @state factor = 2;
  @memoized times(n: number) {
    return () => n * this.factor;
  }
  render() {
    return <div />;
  }
}

/** Silent: an undecorated method may take whatever it likes. */
export class Plain extends Component {
  @state factor = 2;
  times(n: number) {
    return n * this.factor;
  }
  render() {
    return <div />;
  }
}

/**
 * A base declares one. Reported ONCE, here, and not again for the subclass — every class is analysed, so
 * walking the chain upward as well would say it twice.
 */
export class Base extends Component {
  @state factor = 2;
  @compute scaled(by: number) {
    return by * this.factor;
  }
  render() {
    return <div />;
  }
}

export class Derived extends Base {}
