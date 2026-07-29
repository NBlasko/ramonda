---
"@ramonda/core": minor
"@ramonda/query": patch
---

`@watchProp`'s selector is typed from the class it is on — no annotation, no type argument.

```tsx
@watchProp((props) => props.userId)   // props is UserProps
reload(next: string, previous: string) {}
```

`props.usreId` is now a compile error where it used to be `unknown` (so anything compiled).
The mechanism is the same one `@Host` and `@StableProps` use: `This` appears only in the
decorator CONTEXT and inside a conditional type (`PropsOfInstance<This>`), and a conditional
is not an inference site — so TypeScript defers it to the application, where the decorated
class supplies it. The selector's return type still fixes the value type, so the method is
checked as `(V, V) => void`.

**Hooks needed one addition to make this work.** `Hook.props` is `protected`, so a
conditional type reads `never` off it, where `BaseComponent.props` is public. `Hook` now
carries its props type in a phantom — `declare readonly [PROPS_TYPE]?: R`, symbol-keyed and
optional, so it emits nothing, collides with nothing, and appears in no autocomplete.

**What still needs annotating, and why.** The decorated METHOD's parameters. A decorator
does not contextually type the signature it decorates, so unannotated parameters are an
implicit `any` (TS7006) — measured, not assumed. That is a TypeScript limitation.

Annotated selectors keep working when the annotation matches. Three inside `@ramonda/query`
did not: `(props: QueryProps<unknown>)` on a `Query<TData, K>` is not the same type, and the
compiler now says so. They are unannotated, which is what the change is for.
