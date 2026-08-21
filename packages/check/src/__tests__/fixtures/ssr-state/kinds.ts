/**
 * The lossy kinds, as declarations rather than the real globals.
 *
 * The analyzer runs with `noLib: true` and `types: []`, so `Map` and `Date` are not in scope. What
 * the rule reads is the NAME in the `new` expression, which is why a stand-in proves the same
 * thing — and why an app's own `Map`, imported under any name, is described the same way.
 */
export declare class Maps<K, V> {
  get(key: K): V;
}
export declare class Dates {
  getTime(): number;
}
