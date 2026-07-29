import { test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { createSubscriptionDecorator, state } from "../base/decorators";

interface Store {
  subscribe(fn: (value: number) => void): () => void;
  emit(value: number): void;
}

function makeStore(): Store {
  const listeners = new Set<(v: number) => void>();
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(v) {
      for (const fn of listeners) fn(v);
    },
  };
}

const store = makeStore();

/**
 * What a subscription decorator already infers, and what it cannot.
 *
 * `connect` is written by the decorator's AUTHOR, before any class exists, so the owner type
 * cannot come from the decoration site the way `@Host`'s and `@watchProp`'s do. What it can
 * do is the other direction: the author CONSTRAINS the owner, reads from it, and the
 * decoration site is then checked against that. Nothing in the repository tested it, and the
 * three facts below are each easy to break.
 */

/** 1. Can the author constrain the owner and READ from it inside connect? */
const onStoreForRows = createSubscriptionDecorator(
  "onStoreForRows",
  (owner: Component<{ id: string }>, handler: (value: number) => void, s: Store) => {
    // If this type-checks, the author can already reach the concrete owner.
    const prefix = owner.props.id;
    return s.subscribe((v) => handler(v + prefix.length));
  },
);

class Row extends Component<{ id: string }> {
  @state seen = 0;

  @onStoreForRows(store)
  onValue(value: number) {
    this.seen = value;
  }

  render() {
    return <span>{String(this.seen)}</span>;
  }
}

/** 2. A class without that prop must be rejected. */
class Wrong extends Component<{ other: number }> {
  // @ts-expect-error — the connect requires an owner with `props.id`, and the message says
  // so by name rather than talking about contravariant `access.has`.
  @onStoreForRows(store)
  onValue(value: number) {
    void value;
  }

  render() {
    return <span>x</span>;
  }
}

/** 3. Are the decorated method's params inferred from `handler`? */
class Bare extends Component<{ id: string }> {
  @onStoreForRows(store)
  // @ts-expect-error — TS7006: a decorator does not contextually type the signature.
  onValue(value) {
    void value;
  }

  render() {
    return <span>x</span>;
  }
}

test("connect receives the concrete instance, and the constraint is enforced", async () => {
  const app = await getDOM<Row>(<Row id="abc" />);
  await app.settle();
  store.emit(1);
  await app.settle();
  // 1 + "abc".length — the value passed through `connect`'s closure over the real owner.
  expect(app.instance.seen).toBe(4);
  void [Wrong, Bare];
});
