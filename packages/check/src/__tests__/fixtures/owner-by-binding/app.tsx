import { Component, Hook, compute, state } from "@ramonda/core";

/**
 * A props callback's owner, and a cached reader's `this`, matched by what each name resolves to: an inner
 * parameter of the same name is somebody else's, and a `function` written inside has a `this` of its own.
 * Each rule that reads a callback is here, with one read it reports beside the ones it must not.
 */

class Plain extends Hook<{ conf: unknown; n: number }> {}
class Takes extends Hook<{ value: unknown }> {}

/** `fresh-object-in-hook-props`: a literal rebuilt when the callback runs again. */
class Fresh extends Component {
  @state tick = 0;
  /* REPORTED — `tick`, the owner's, read through the destructured parameter. */
  read = this.use(Plain, ({ tick }: Fresh) => ({ conf: { dense: true }, n: tick }));
  /* Not reported: the inner `tick` is the arrow's own parameter. */
  shadowed = this.use(Plain, ({ tick }: Fresh) => ({ conf: { dense: true }, n: [1, 2].map((tick) => tick).length }));
  /* Not reported: a `function`'s `this` is its own. */
  ownThis = this.use(Plain, () => ({
    conf: { dense: true },
    n: [1].map(function (this: { tick: number }) {
      return this.tick;
    }).length,
  }));
}

/** `field-read-before-it-is-declared`: a callback reading a field declared below its `use()`. */
class Early extends Component {
  /* REPORTED — `later` is undefined when this callback first runs. */
  first = this.use(Takes, () => ({ value: this.later }));
  /* Not reported: a `function`'s `this` is its own, not the component's. */
  second = this.use(Takes, () => ({
    value: [1].map(function (this: { later: number }) {
      return this.later;
    }),
  }));
  later = 1;
}

/** `cached-read-of-a-plain-field`: a `@compute` reading a field a method writes. */
class Cached extends Component {
  @state tick = 1;
  rate = 1;

  bump(): void {
    this.rate = 3;
  }

  /* REPORTED — an arrow keeps the component's `this`. */
  @compute get arrow(): number {
    return [this.tick].map((n) => n * this.rate).length;
  }

  /* Not reported: a `function`'s `this` is its own. */
  @compute get own(): number {
    return [this.tick].map(function (this: { rate: number }, n: number) {
      return n * this.rate;
    }).length;
  }
}

export { Fresh, Early, Cached };
