import { Component } from "../base/Component";
import {
  compute,
  deferHydration,
  Host,
  interval,
  memoized,
  onDocument,
  onWindow,
  state,
  updated,
} from "../base/decorators";

/**
 * What the decorator signatures promise about the METHODS they are put on, pinned in both directions.
 *
 * Not a test file — there is nothing to run. These are claims checked by this package's own
 * `check-types`, and a shape under `@ts-expect-error` that starts compiling fails the build as an
 * unused directive, so relaxing any of this cannot pass quietly.
 *
 * ## Why this file exists
 *
 * A repo-wide type-check can be a FALSE green, and this is the case that proved it. `@updated`'s
 * `value: (...args: any[]) => void` was narrowed to `unknown[]`, all 27 `check-types` tasks passed, and
 * it would have refused the first application that wrote `@updated after(n: number)` with **TS1241** —
 * because a parameter is contravariant, so `unknown` is the WRONG bound. Nothing in this repository
 * declares a parameter on such a method, so nothing here could have caught it.
 *
 * Measured, on exactly the shape below:
 *
 * ```
 * any[]      accepts it, and is `any`
 * unknown[]  REFUSES it — TS1241
 * never[]    accepts it, and is not `any`
 * ```
 *
 * `never[]` is the bound: `never` is assignable to every parameter type, so every method fits. The
 * claims below are what stops that being undone.
 */

class ParameterClaims extends Component {
  @state count = 0;

  /** A lifecycle method with a parameter. This is the shape the wrong bound refused. */
  @updated after(n: number) {
    void n;
  }

  /** And with none, which is what every method in this repository happens to be. */
  @updated plain() {}

  /** Several parameters, and one of them optional. */
  @updated many(a: string, b?: boolean) {
    void a;
    void b;
  }

  @deferHydration later(reason: string) {
    void reason;
  }

  /** A `@compute` getter still returns what it returns, rather than being widened. */
  @compute get doubled(): number {
    return this.count * 2;
  }

  /** `@memoized` keeps its argument and return types — the caller gets a real handler. */
  @memoized pick(id: number) {
    return () => {
      void id;
    };
  }

  render() {
    const handler: () => void = this.pick(1);
    const n: number = this.doubled;
    void handler;
    void n;
    return <div />;
  }
}

/**
 * The subscription family declares its event parameter, and this is the likeliest casualty of a future
 * "tightening": `createSubscriptionDecorator`'s `Handler` carries the same bottom-typed rest, and every
 * one of these is written WITH a parameter in real code.
 */
class SubscriptionClaims extends Component {
  @onWindow("resize") onResize(event: UIEvent) {
    void event;
  }

  @onDocument("click") onClick(event: MouseEvent) {
    void event;
  }

  @interval(100) tick() {}

  render() {
    return <div />;
  }
}

/** `@Host` takes a COMPONENT class, and the constraint is the same bottom-typed constructor. */
@Host("section")
class Hosted extends Component<{ id: string }> {
  render() {
    return <div>{this.props.id}</div>;
  }
}

/** And refuses one that is not a component. */
class NotAComponent {}
// @ts-expect-error — `__isComponent` is what the constraint asks for, and a plain class has none.
@Host("section")
class Rejected extends NotAComponent {}

void ParameterClaims;
void SubscriptionClaims;
void Hosted;
void Rejected;
