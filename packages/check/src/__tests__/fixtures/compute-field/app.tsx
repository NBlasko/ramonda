import { Component, Hook, Host, bootstrap, compute, created, destroyed, mounted, state } from "../framework";

declare function expensive(): number;

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

bootstrap(<Cart />, null);
