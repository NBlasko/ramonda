---
"@ramonda/core": patch
---

`@StableProps` now type-checks on a context Provider.

It always WORKED there — declaring a key takes a consumer from four renders to one, measured in
`ContextValueIdentity.test.tsx` — but it would not compile, which is the worst way for a gate to be
wrong: the recommended fix was a type error.

`createContext` hands back `new (owner, options: T) => BaseHook<T> & Readonly<T>`, and `BaseHook`
carries no props phantom the way `Hook` does. So the decorator fell through to its COMPONENT branch,
which reads the props off the constructor's first parameter — and for a hook that parameter is the
runtime. Every name was then "not a prop of this class".

It is told apart by its RETURN, like the branch beside it, so a component cannot reach it. Putting
the phantom on `BaseHook` instead was tried and reverted: reading the type parameter makes the class
variant in it, and `this.use()`'s overloads stopped resolving for every hook in the repo.
