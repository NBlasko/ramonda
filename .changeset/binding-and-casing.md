---
"@ramonda/core": minor
"@ramonda/query": patch
---

`_`-prefixed methods are bound like any other, `@Host` infers its class, and class
decorators are PascalCase.

**Method binding no longer skips `_`-prefixed methods.** The skip was a performance
opt-out — internal by convention, so binding was not paid for it — and the convention is
not this framework's to claim. typescript-eslint's `naming-convention` rule is commonly
configured with `leadingUnderscore: "require"` for private members, so a project with that
rule wrote `private _apply()` and got a method that silently did not bind:
`onClick={this._apply}` then lost `this`, with no error and no diagnostic. A lint rule
chosen for unrelated reasons broke the framework's central promise about methods.

Nothing internal needed it, which was checked rather than assumed: there are no
`_`-prefixed members on `Component.prototype` or `Hook.prototype`, `_componentInstance` and
`_componentDefinition` live on DOM nodes, and `Context`'s `_subscribedKeys` is a field —
fields are never bound. (The comment justifying the skip pointed at "the note in
Component.ts". There was no such note.)

And it bought little. Measured per instance, binding every method against binding all but a
third of them: 3 methods 41 ns, 5 methods 10 ns, 8 methods 84 ns, 12 methods 212 ns — a
fifth of a millisecond across a thousand rows, at twelve methods. If an opt-out is wanted
back it should be an explicit `@unbound` decorator, which says what it does where it does
it and cannot be triggered by a lint rule.

**`@Host` needs no type annotation and no type argument.** `self` in its props callback, and
`props` in its tag callback, are now typed from the decorated class:

```tsx
@Host("section", (self) => ({ "data-label": self.label }))   // self is Card
class Card extends Component<{ label: string }> {}
```

The mechanism is worth recording: both parameter types are CONDITIONAL types over the class
(`InstanceOf<C>`, `PropsOf<C>`), and a conditional is not an inference site — so TypeScript
cannot resolve `C` from the decorator's arguments and defers until the decorator is applied,
where the class supplies it. The obvious shape (a type parameter sitting directly in the
callback's parameter position) fixes it to `unknown` from an unannotated arrow before the
class is ever looked at, which is why this used to need `(self: Card)` spelled out.

**`@stableProps` is renamed `@StableProps`** — class decorators are PascalCase (`@Host`,
`@StableProps`), member decorators are camelCase (`@state`, `@compute`, `@watchProp`). The
casing is the only thing that tells you where a decorator goes, and the two groups are used
in different places. Documented in the API reference.
