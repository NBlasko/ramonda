---
"@ramonda/core": patch
---

RMD056: one context provided twice by the same component.

A component publishes a context on ONE object — its own — so a second Provider of the same context
replaced the first under the same key, and every descendant read the second. Nothing said so.

**Measured before it was written.** `first = this.use(ThemeProvider, () => ({ theme: "first" }))` and
`second = this.use(ThemeProvider, () => ({ theme: "second" }))` on one component: the descendant reads
`"second"`, while the component itself reads `first.theme === "first"` and
`second.theme === "second"`. That is what hid it — a Provider provides AND reads, so the component
that made the mistake is the one place it looks fine.

The check is `Object.hasOwn(owner.context, contextId)`, and own-ness is the whole question. A context
object is `Object.create(parentContext)`, so a Provider ABOVE this component leaves the key inherited
here rather than own — that is nesting, it is ordinary, and it stays silent. Only a second publish on
one component makes the key own. Both directions are under a gate: silencing the check fails the
report test, and widening it to `in` fails the nesting test, which is the mistake the shorter spelling
would make.

**It reports rather than throwing**, unlike a plain-object props bag (RMD055). There a shipped bundle
would go on serving a value nobody set; here the page has one deterministic reading, and refusing it
would break an app that has been living with the first Provider ignored. Severity `error`, so the
devtools panel raises its alert, and a later version can refuse.

**It fires twice on this repository, and both are real.** `@ramonda/form`'s tests mount two `Form`
hooks on one component — `Focus.test.tsx` and `Validation.test.tsx` both do it deliberately — and a
`Form` publishes itself on the form context so descendants can find it. So the second form replaces
the first, and **a descendant that reaches its form through the context binds to the second one
whichever form's markup it is in**. Measured: submit the first form and its own `submitCount` is 1
while a descendant `FormState` reads 0. Form's own tests do not catch it because they all reach the
forms directly, as `this.a` and `this.b`. That is `@ramonda/form`'s to fix and is not touched here;
the diagnostic is what found it.

Deduped per context and owning component. DEV only — the check and its message are inside `__DEV__`,
and measured on a production bundle of `Context.ts`: `consumedBy`, both probes, the report function,
`diagnose` and both codes are absent.
