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

/** Every other way of reading `use` off the instance, each REPORTED. */
class Spelled extends Everywhere {
  viaSuper(): void {
    /* REPORTED — the base's `use`, through `super`. */
    super.use(Counter);
  }
  viaIndex(): void {
    /* REPORTED — by its name in brackets. */
    this["use"](Counter);
  }
  viaCall(): void {
    /* REPORTED — through `.call`. */
    this.use.call(this, Counter);
  }
  viaBind(): void {
    /* REPORTED — through `.bind`. */
    this.use.bind(this)(Counter);
  }
  viaAlias(): void {
    /* REPORTED — taken out under its own name. */
    const { use } = this;
    use.call(this, Counter);
  }
  viaCast(): void {
    /* REPORTED — through a cast of `this`. */
    (this as Spelled).use(Counter);
  }
  viaFunction(): void {
    /* Not reported: a `function`'s `this` is its own, even one declared as this class (TODO 184). */
    [1].forEach(function (this: Spelled) {
      this.use(Counter);
    }, this);
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

export { Fields, Inner, Everywhere, Spelled, Grows };
