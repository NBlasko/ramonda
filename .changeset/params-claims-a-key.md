---
"@ramonda/check": minor
---

An argument-less `params()` is judged by the keys it names

`params(pattern)` is checked twice — the router throws in `assertPattern`, and the graph says it
before anything renders. `params()` was checked nowhere, and the router's own message sends people to
it: "drop the argument and use `params<T>()` if it is rendered by routes that do not agree on their
params". So the door people are pointed at was the unguarded one.

Judging it is not a contradiction of that advice, because the pattern argument was never an assertion
about which route you are on. Measured: `ParamPath<C>` is any table path carrying a `:param`, and
`assertPattern` compares only the NAMES against what matched — a component under `/users/:id/edit`
and `/admin/users/:id` may name either and is right on both. The argument names keys. Both doors ask
the same question and only one of them was answered.

And this failure is the quieter of the two: `Router.tsx` calls `assertPattern` only
`if (pattern !== undefined)`, so nothing throws. The read hands back a params object without the key,
and a type that promised `string` delivers `undefined`.

Three spellings are a claim, because each names a key AT the call: `params<{ teamId: string }>()`, a
plain `const { teamId } = params()`, and `params().teamId`. Three are not: `?` on the member, a
default in the destructuring, and a read taken off a variable one line later — the last being the
escape the router's message points at, kept open on purpose. Two limits are named rather than hidden:
a type argument that is a name rather than a written-out shape, and a key built from an expression.

Every silence the pattern door keeps is kept here — no root, an outlet spreading props nobody can
read, a declaration no root reaches, a route key that is not a literal — and a claim inside a hook is
judged against the route above the component that uses it.
