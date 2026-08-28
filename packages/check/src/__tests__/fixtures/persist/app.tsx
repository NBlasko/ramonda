import { Component, bootstrap, persist, state } from "@ramonda/core";

declare class Map<K, V> {
  get(key: K): V;
  set(key: K, value: V): void;
}
declare class Set<T> {
  add(value: T): void;
}
declare class Date {
  getTime(): number;
}
declare class Formatter {
  format(value: number): string;
}
declare function loadRows(): unknown[];

/**
 * Every shape `persist-of-a-lossy-value` has an opinion about, beside every shape it must not.
 *
 * `@state` fields sit here on purpose: the same value in `@state` is NOT reported, because reactive
 * state only reaches the blob on a server render and a browser-only project may hold anything in
 * it. The decorator is the whole difference, so the fixture writes both.
 */
class Cart extends Component {
  /* REPORTED — a `Map` arrives as `{}`. */
  @persist byId = new Map<string, number>();
  /* REPORTED — a `Set` goes the same way. */
  @persist seen = new Set<string>();
  /* REPORTED — a `Date` arrives as a string. */
  @persist openedAt = new Date();
  /* REPORTED — a class instance loses its prototype and every method with it. */
  @persist money = new Formatter();
  /* REPORTED — JSON drops a function without a word. */
  @persist compare = (a: number, b: number) => a - b;
  /* REPORTED — a lossy value one level inside an object literal. This is the COMMONEST shape of
     the fault and the first version of this rule missed it, while its runtime twin RMD033 was
     widened to recurse for exactly this reason. */
  @persist meta = { openedAt: new Date() };
  /* REPORTED — and inside an array. */
  @persist stamps = [new Date()];

  /* REPORTED — no initializer, but the annotation says it all. */
  @persist pending: Map<string, boolean>;

  /* Not reported: JSON carries all of these. */
  @persist total = 0;
  @persist label = "cart";
  @persist rows = [];
  @persist detail = { open: false };
  @persist nothing = null;
  /* Not reported: a call this cannot read — the silence contract. */
  @persist loaded = loadRows();
  /* Not reported: an annotation naming nothing lossy. */
  @persist name: string;

  /* Not reported: `@state` is reactive state, and only a server render puts it in the blob. */
  @state formatter = new Formatter();
  @state stamp = new Date();

  render() {
    return (
      <div>
        <div>{this.label}</div>
      </div>
    );
  }
}

bootstrap(<Cart />, null);
