---
"@ramonda/core": minor
"@ramonda/check": minor
---

`createContext(defaults, { stableProps })` — a context declares which keys are values

A key holding an object literal is a new object every time the provider's callback runs, and a new
object is a changed key — so every consumer of it wakes, however unchanged the contents are.
Measured in `ContextValueIdentity.test.tsx`, counting a consumer that reads only `conf` while a
DIFFERENT key of the same provider moves three times:

| the provider | consumer renders |
|---|---|
| `() => ({ conf: { dense: true }, tick: this.tick })` | **4** |
| the same, with `stableProps: ["conf"]` on the context | **1** |

The declaration already existed as `@StableProps`, and a context could not reach it. `createContext`
returns a class rather than a declaration site, so the only way to attach a decorator was to write a
subclass that did nothing else:

```tsx
@StableProps("conf")
class ConfProvider extends ThemeProvider {}
```

Now it is said where the context is made, which is where the answer lives — whether `conf` is a
value or an identity is the context's own knowledge, and it is true for every provider of it:

```tsx
const [ConfProvider, ConfConsumer] = createContext(
  { conf: { dense: false }, tick: 0 },
  { stableProps: ["conf"] },
);
```

**It is one mechanism, not two.** The option writes the same list the decorator writes, on the same
class, read by the same lookup. The subclass spelling still works and is still type-checked.

**It can do one thing the decorator cannot.** A context's keys are the default value's keys — a
Provider publishes nothing outside them, so no consumer could read a key outside them. That makes a
name that is not one of them a mistake this end can SEE. It is refused twice: by the types, against
`keyof` the default value, and at runtime for a caller who has none. A decorator on a class knows
only the type it was handed.

The comparison itself is unchanged, including what it will not do: **functions are never covered**,
because two closures with the same body are not equal by any comparison that is safe to make, so a
listed function key is left exactly as it came and `RMD022` still reports it. Contents that really
move still arrive — this is a comparison, not a freeze.

**`@ramonda/check` reads the new spelling**, and had to before the advice could recommend it — a
rule that cannot see a declaration reports the fix. `fresh-object-in-hook-props` and
`fresh-object-in-props` now ask one question that answers for both spellings, and
`fresh-object-in-hook-props`'s advice points at the option instead of at a subclass. The call is
identified through core rather than by the letters at the call site, so `import { createContext as
makeContext }` is read exactly the same — the same lesson an aliased `@StableProps` taught this rule
once already, when it reported the very key a child had declared.
