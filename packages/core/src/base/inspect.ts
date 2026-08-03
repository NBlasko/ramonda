/**
 * A method an instance can define to say what it actually HOLDS, for the devtools panel.
 *
 * ```ts
 * class Form<S> extends Hook<FormProps<S>> {
 *   [INSPECT]() {
 *     return { values: this.current, errors: [...this.issues] };
 *   }
 * }
 * ```
 *
 * The inspector reads `@state`, `@persist`, props and context reads — all four of which are about
 * how a value was DECLARED. A hook that keeps its state in plain fields behind a `@state` counter
 * therefore shows a counter and nothing else, which is the whole picture the panel had for
 * `@ramonda/form`: `{ version: 7 }`, and inputs that never change.
 *
 * That shape is not an oversight, it is what the framework recommends. `@state` means "serialise me
 * into the hydration blob", and a form's values are whatever the schema's input side is — a `Date`,
 * a `File`, a class instance — so declaring them would put a warning in front of every form holding
 * one. `Mutation` does the same with `lastData` behind its own `version`.
 *
 * **Per instance, found by the walk that already visits it.** `registerStore` was removed from the
 * devtools bridge because it let a module-level singleton publish itself, advertising the global
 * pattern this framework steers away from. This has the opposite property: an instance outside the
 * tree cannot contribute, and one that unmounts stops contributing with nothing to deregister.
 *
 * ## It must be a pure READ
 *
 * The panel calls this on every commit while it is open on the components tab — the same cadence as
 * reading `@state`, not a timer. So writing state from inside it closes a circle: the write
 * schedules a render, the render commits, the commit pings the panel, and the panel asks again.
 *
 * **Nothing catches that today.** Measured: five scans over a `[INSPECT]()` that increments a
 * `@state` field moved it five times and reported no diagnostic — RMD009 watches for a component
 * that will not stop rendering, and this only turns while somebody is looking. A diagnostic for it
 * is recorded in `notes/core-followups.md`; until then this paragraph is the whole guard.
 *
 * Read fields, derive values, and return. No writes, no fetches, no logging — the panel is open
 * precisely when someone is trying to work out what is wrong, and a method that changes the app
 * while describing it is the worst possible thing to be debugging through.
 *
 * `Symbol.for` rather than `Symbol()`, so two copies of core in one app still agree — the same
 * reason `@ramonda/form` keys its field-node marker that way.
 */
export const INSPECT: unique symbol = Symbol.for("ramonda.inspect");
