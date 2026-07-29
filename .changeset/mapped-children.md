---
"@ramonda/core": minor
"@ramonda/query": minor
---

RMD023, `static StableProps`, and `each` that takes nothing.

**RMD023 — components built from an array with no keys.** The check RMD020 cannot make: a
mapper is handed to `Array.prototype.map` and never stored anywhere a comparison can reach,
and its output is a run of freshly built vnodes, which is what all JSX looks like. Structure
is the only evidence — JSX passes children as separate arguments, so a nested array among
them was built by an expression. `normalizeChildren` brands its own arrays (DEV only) so
`{this.props.children}` is not mistaken for a mapped one.

Narrowed twice, and the history is the reason to trust it. Reporting every raw array broke
10 of core's own tests, all exercising child groups on purpose — a mapped array is a
supported shape here, with its own key space. What ships reports only what is genuinely
unhandled: two or more UNKEYED COMPONENT rows, whose identity is their position, so
inserting or removing anywhere but the end moves state and DOM to the wrong item. Plain
markup is not reported (the diff patches it and the result is correct), keyed children are
not reported, forwarded children are not reported.

**`static StableProps` — the hook declares which props are values, so the call site does
not.** A query key is a value: `["user", 7]` built again is the same question, and that is
the hook's knowledge rather than something every component using it should encode. `Query`
declares `key`, `Mutation` declares `invalidates`, and the framework hands back one identity
for as long as the contents are equal:

```tsx
key: ["user", self.props.id]   // a plain literal; nothing to wrap
```

`stable()` stays for the other direction — a hook you do not own that declared nothing. A
declaration cannot cover a function prop: two closures with the same body are not equal by
any comparison that is safe to make, so a listed function is left alone and still reported.

**`each` accepts `null` and `undefined`** and renders nothing for them. The list engine
already handled it; only the type forbade it. This removes the `?? []` that every "data has
not arrived yet" list was writing — a fresh empty array on every render, which cost the list
its item scopes and was itself reported by RMD020.

**Documentation: what a hook author cannot assume.** A reusable hook is written against what
it might be handed, not against a well-behaved caller — it does not know when it will be
called, whether a value is the same object as last time, what the value is, or whether the
diagnostics are even running. So: compare by value what is a value, and be idempotent about
the rest. `Query.onKeyChanged` is the worked example, comparing the key itself even though
the framework already did.
