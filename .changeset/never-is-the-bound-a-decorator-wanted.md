---
"@ramonda/core": patch
"@ramonda/router": patch
---

A third pass over `any`: **60 → 38**, still zero `as any` — and the answer to a question item 33 had left
open.

**`never[]`, not `unknown[]`, is the bound a lifecycle decorator wants.** `@updated` and
`@deferHydration` declared `value: (...args: any[]) => void`, with a comment saying a repo-wide
type-check could not prove `unknown[]` safe. Measured on the shape nothing here contains:

```
any[]      accepts `@updated after(n: number)`, and is `any`
unknown[]  REFUSES it — TS1241, because a parameter is contravariant
never[]    accepts it, and is not `any`
```

So the signature did not need to lose its parameters; it needed the right bottom type. The same applies to
every constructor CONSTRAINT — `@Host`, `@ShouldUpdateOnPropsChange`, and the `InstanceOf`/`PropsOf`/
`HookPropsOf` helpers. `src/__tests__/DecoratorTypeClaims.tsx` pins it: put `unknown[]` back and two
`TS1241`s appear, which is what a false green looked like.

**And the opposite direction, which is the other half of the rule.** `@ramonda/router`'s
`NoPropsHookClass` needed `unknown`, not `never`: it types a VALUE that must accept core's real
`Runtime`, and a parameter typed `never` refuses it. `never` is right in a constraint, `unknown` is right
in a value's parameter, and `any` was standing in for both.

**Three types that were claiming the wrong thing, found because an `any` had been hiding them:**

- `Effect.effect` was `() => undefined | (() => void)` while the runner guards with
  `typeof res === "function"` and ignores anything else. It is `() => unknown` now, with the one
  assumption named in an `isCleanup` predicate instead of bridged by an `any` in `attachEffect`.
- `ComponentRuntime.rawProps` was `RenderableProps<any>`, which is the props SHAPE — but every reader
  treats it as a bag, and `debug/inspector.ts` already declared it as one. Typed
  `Record<string | symbol, unknown>`, it also deletes the two casts in `Component.ts` that said so.
- `areStringRecordsEqual` took `Record<string, string | undefined>` and its one caller passes props,
  whose values are handlers and objects. Renamed `arePropsBagsEqual`, over `unknown` — the body only
  counts keys and compares with `!==`.

`EnhancedHTMLNode._listeners` is `Record<string, EventListener>`, which is exactly what goes in and comes
out of `add`/`removeEventListener`.

The counting script now lives at `scripts/dev/count-any.mjs` rather than in a scratch directory, because
the last two passes' numbers were not comparable once their script was gone.
