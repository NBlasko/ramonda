---
"@ramonda/check": minor
---

A new rule: `watch-of-a-prop-that-is-not-there`.

The selector **is** the declaration: `@watchProp((p) => p.userId)` says to run the method when
`userId` changes. Name something that is not a prop and the selector reads `undefined` on every
render, which never differs from the `undefined` before it — so the method **never runs**, for the
whole life of the component. Nothing throws. The reaction is simply absent, and whatever it kept in
step drifts.

`tsc` refuses this too, as `TS2339` — until somebody writes `(p: any) => …`, a `@ts-ignore`, or
widens the props type for an unrelated reason. A type is a defence only while nobody casts it away.

The props type is read as **syntax**, never as a question to the checker: the type argument on
`extends Component<…>`, written out as a literal or naming an interface or alias whose declaration
can be found — including one imported from another file.

The silence carries most of this rule, because naming a real prop as missing is the one failure that
would get it switched off. The whole class is left alone when the members cannot all be enumerated:
no type argument, an index signature, an intersection, a union, a mapped type, a generic
instantiation, an interface that `extends` something or is declared twice. A selector this cannot
read — `(p) => p[key]` — is skipped on its own.

Three spellings of the read are checked: `p.userId`, `p["userId"]` and `({ userId }) => userId`.
Only the first level is a prop, so `p.user.id` is judged on `user`.
