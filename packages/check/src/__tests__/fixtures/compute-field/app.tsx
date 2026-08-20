import { Component, Hook, Host, bootstrap, compute, created, destroyed, mounted, state } from "../framework";

declare function expensive(): number;
declare function makeProps(): { rate: number };

class Clock extends Hook {
  now = 0;
}

/**
 * A `@compute` over an ordinary field that something writes after the first render.
 *
 * The pairing is the whole test, and here it is unusually load-bearing: a plain field read by a
 * compute is an extremely common CORRECT shape, so a rule that reported the read alone would report
 * most components. The write is what makes it a fault, and every kind of write that cannot make it
 * one sits here beside the one that can.
 */
@Host("div")
class Cart extends Component {
  @state tick = 0;

  /* The fault: an ordinary field, read by a compute, written by a handler. */
  rate = 2;
  /* A constant. Nothing writes it, so the compute can never be stale. */
  prefix = "Total: ";
  /* Written before the first render only, so the first computed value already has it. */
  currency = "";
  /* Written after the last render. */
  closed = false;
  /* The memo pattern — written from inside the compute itself. */
  cached = 0;
  /* A hook, which carries its own reactivity. */
  clock = this.use(Clock);
  /* A function, which is `arrow-fields`' subject rather than this one's. */
  format = (n: number) => String(n);

  @created setUp() {
    this.currency = "RSD";
  }

  @mounted start() {
    this.rate = 3;
  }

  @destroyed tearDown() {
    this.closed = true;
  }

  bump() {
    this.tick++;
  }

  /* REPORTED — `rate` is written by `start`, and this cache does not notice. */
  @compute get total() {
    return this.tick * this.rate;
  }

  /* REPORTED — a hook's props callback caches the same way a `@compute` does, so an ordinary
     field goes stale in it too. This is `RMD027`'s own root cause, in the runtime's words: "most
     often a plain field standing in for state". */
  form = this.use(Clock, () => ({ rate: this.rate }));

  /* Not reported: the factory is a value this cannot follow without dataflow. */
  other = this.use(Clock, makeProps);

  /* Not reported: `prefix` and `currency` are never written after the first render. */
  @compute get label() {
    return this.prefix + this.currency + this.format(this.tick);
  }

  /* Not reported: the write is inside the compute, which is the memo pattern. */
  @compute get heavy() {
    if (this.cached === 0) this.cached = expensive();
    return this.cached;
  }

  /* Not reported: a hook is not a plain field. */
  @compute get stamp() {
    return this.clock.now;
  }

  render() {
    return (
      <div onClick={() => this.bump()}>
        {this.label}
        {String(this.total)}
        {String(this.heavy)}
        {String(this.stamp)}
        {String(this.closed)}
      </div>
    );
  }
}

/**
 * The field on a BASE, the write and the read on the subclass — one instance, one stale cache.
 *
 * The plain-field set and the "who writes it" pass both read a single class body, so a shared base
 * holding the field made every one of these invisible.
 */
class Totals extends Component {
  protected rate = 1;
  @state open = true;

  render() {
    return <div />;
  }
}

class Priced extends Totals {
  bump() {
    /* An ordinary write, after the first render. */
    this.rate = this.rate + 1;
  }

  /* REPORTED — `rate` is the base's plain field, and this cache never hears about the write. */
  @compute get total() {
    return this.rate * 2;
  }

  /* Not reported: the base declares `open` as @state, so the chain says it is tracked. */
  @compute get label() {
    return this.open ? "open" : "shut";
  }

  render() {
    return <div onClick={() => this.bump()}>{String(this.total)}</div>;
  }
}

bootstrap(<Cart />, null);
bootstrap(<Priced />, null);
