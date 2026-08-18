---
"@ramonda/core": minor
---

A second pass over `any`, and the `__isComponent` probe written once.

**Counted the same way each time, and the method is now written down so the next pass is
comparable:** every published package's `src`, tests and `.d.ts` excluded, comments and string
literals stripped, `any` matched as a word. **105 → 60, and `as any` stays at zero.** The 111 quoted
by the previous pass came from a script that no longer exists, so 105 is this script's reading of the
same tree before this change, not a claim that six went missing.

What went, each measured rather than assumed:

- **`State<any>`, all eleven of them** — the tracker's dependency sets, `propsSignals`,
  `@compute`'s cache. `State<unknown>` accepts a `State<number>` because `set` is declared as a
  method and methods are bivariant, so nothing at the edges had to change. Core's type-check covers
  175 test files with concrete signal types in them, which is what makes this a real green.
- **`BaseComponent<any>`, all ten** — the task queue, the lifecycle walks, the effect runner.
  `BaseComponent<unknown>` works; `BaseComponent<never>` does not, and the error says why — `props`
  is read, so `never` is the wrong end. `testing.ts` gets away with `never` because there it is a
  RETURN type.
- **The props bag inside `useCommon`** is now a named `Bag = Record<string, unknown>` — build,
  compare, cache and hand on, all by key, nothing reading into a value. Typing it named a state the
  code had left unsaid: `PropsCache.bag` was `undefined` until the first build, which is now the
  shared `NO_BAG` beside the `isDirty` flag that already says when the bag is meaningful.
- **`Lazy` is `() => Promise<Record<string, unknown>>`** rather than `Promise<any>`, so the module
  namespace a page loader resolves is typed and `res[namedExport]` is `unknown` at the point where
  the code already asks `typeof component !== "function"`. Proved against the real shape:
  `() => import("./mod")` is assignable. `apps/docs`' generated loader map now imports `Lazy` instead
  of restating the signature, which is what caught this at all.
- **`@state`'s ignored initializer, its setter, `buildKey`, `describeUnkeyableArgs`, `memoMap`'s key,
  `hooksOptions`, `componentFactory`'s props** — each of these took `any` where the code only ever
  passes the value on or asks `typeof` about it.
- **`@memoizedHandler`'s context is `ClassMethodDecoratorContext<{ [GLOBAL_RUNTIME]: Runtime }, T>`**
  rather than bare, so the initializer's `this` is typed by the context instead of by `any`. It also
  refuses the decorator on a class the framework does not own, which is a class it never worked on.

**`isComponentClass` in `vdom/guards.ts`.** The same probe was written five ways — four carrying
`as unknown as { __isComponent?: boolean }` and one taking its argument as `any`. `@Host`,
`@ShouldUpdateOnPropsChange`, `@StableProps` and `lazy`'s `toRenderable` now ask it once, and the
casts have nowhere left to be. Four casts and one `any` gone. Breaking the predicate on purpose fails
**290 of core's 1122 tests**, so it is under a gate rather than beside one.

`h.ts` is the one caller that keeps its own probe, and the reason is written beside it: `name` there
is `ComponentKind | UnsupportedTagFn`, and `UnsupportedTagFn` is `(props: never) => RamondaNode`,
which TypeScript will not separate from a construct signature — so the predicate narrows to a union
of the two and the cast comes straight back.

**Where `any` earns its keep, so the next pass does not repeat the experiment:**
`@compute`'s `addInitializer(function (this: any))` cannot be typed from the context, because
`ClassMethodDecoratorContext<This, …>` declares `this` as the unconstrained `This`; typing it costs
two casts inside and constraining `This` is a surface change rather than a tightening. The same is
true of `@memoizedHandler`'s returned handler, which has to stay assignable to the method's own `T`.
The rest are inference and constraint positions — `new (...args: any[]) => infer I`,
`Record<string, any>` on JSX attributes and on a decorator context's instance type — where `unknown[]`
is refused for the reason `decorators.ts` already records.

**A MINOR rather than a patch, because two of these narrow a published type.** `Lazy` no longer
accepts a promise of anything — a `lazy` that resolved the component itself rather than a module
namespace stops type-checking, and it never worked at runtime either (`res[namedExport]` was
`undefined` and threw "Missing named export"). And `@memoizedHandler`'s context now requires the class
to carry the framework's runtime, which refuses the decorator on a class it never worked on. Neither
changes behaviour, and both are refusals a build will show you.

Behaviour is unchanged: 1122 of core's tests pass, and all 28 `check-types` tasks are green.
