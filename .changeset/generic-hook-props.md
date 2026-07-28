---
"@ramonda/core": minor
---

`this.use(Hook, props)` now infers a **generic** hook's type parameter from the props callback.

`use` took one union parameter (`props: Q | R` with `R extends (bag: this) => Q`), which cannot type a generic hook class: `HookProps` is `Record<string, any> | undefined` and a function is assignable to that, so with no fixed candidate for `Q` from the constructor, TypeScript inferred `Q` as the callback itself. A hook like `Query<TData>` came out as `Query<unknown>`. The callback now has its own overload, so `Q` is inferred from the return type — and a type parameter that only appears in a prop (`fetch: () => Promise<TData>`) follows from it with nothing declared at the call site.

**Breaking, in one narrow way:** the callback's parameter is typed `never`, so an *unannotated* one no longer type-checks.

```ts
// before — `bag` was typed from `this`
this.use(SizeHook, (bag) => ({ width: bag.props.width }));

// now — annotate the owner
this.use(SizeHook, (bag: Panel) => ({ width: bag.props.width }));
```

`never` rather than `any` on purpose: an unannotated parameter fails with `Property 'props' does not exist on type 'never'` instead of silently widening to `any`. Typing it as `this` is not an option — resolving an overload would need the type of the class whose field is being declared, which is a TS7022 circularity on every call site. Every call site in this repo and in the docs already annotates.
