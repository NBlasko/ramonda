import { Component, Hook, created, mounted, state } from "@ramonda/core";

class Timer extends Hook<{ run: () => void }> {}
class Counter extends Hook {}

/** The one shape: a field whose initializer is the call. Nothing here is reported. */
class Fields extends Component {
  @state on = false;
  timer = this.use(Timer, () => ({ run: this.tick }));
  private counter = this.use(Counter);
  readonly pinned = this.use(Counter, undefined);
  /* What only the compiler reads changes nothing: still the call, once. */
  typed = this.use(Counter) as Counter;
  checked = this.use(Counter) satisfies unknown;
  wrapped = this.use(Counter)!;
  tick(): void {}
  render() {
    return <p />;
  }
}

/** A hook's own hooks, the same way. Nothing reported. */
class Inner extends Hook {
  counter = this.use(Counter);
  /* A `function`'s `this` is its own: not this hook's `use()`. */
  helper = function (this: { use(hook: unknown): unknown }) {
    return this.use(Counter);
  };
}

/** Every other shape, each REPORTED. */
class Everywhere extends Component {
  @state on = false;
  /* REPORTED — behind a condition in a field. */
  maybe = this.on ? this.use(Counter) : undefined;
  /* REPORTED — once per pass of a loop. */
  many = Array.from({ length: 3 }, () => this.use(Counter));
  /* REPORTED — inside an object built in a field. */
  pair = { counter: this.use(Counter) };
  later: unknown;

  constructor() {
    super();
    /* REPORTED — the constructor body, even unconditionally. */
    this.later = this.use(Counter);
  }

  open(): void {
    /* REPORTED — a method. */
    this.later = this.use(Timer, () => ({ run: this.open }));
  }

  @created made(): void {
    /* REPORTED — a lifecycle. */
    this.use(Counter);
  }

  @mounted ready(): void {
    /* REPORTED — a callback inside a lifecycle. */
    queueMicrotask(() => this.use(Counter));
  }

  render() {
    return <p />;
  }
}

/** In a hook, the same. */
class Grows extends Hook {
  child: unknown;
  grow(): void {
    /* REPORTED — a hook's method. */
    this.child ??= this.use(Counter);
  }
}

export { Fields, Inner, Everywhere, Grows };
