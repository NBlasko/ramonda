---
"@ramonda/core": minor
"@ramonda/check": minor
"@ramonda/form": patch
---

One Provider of a context per component, refused rather than reported — and the scope pattern that replaces it.

RMD056 reported this; it now **throws in every build**, like a write to props (RMD004, RMD015) and a
plain-object props bag (RMD055). A component publishes a context on ONE object, so a second Provider
replaces the first and hands every descendant the second whichever part of the tree it is in — while
the component itself can still read both through its own hooks. **The one place that made the mistake
is the one place it looks fine**, which is exactly why a development-only report was not enough: it
left production doing it silently.

Found on this repository the day RMD056 landed: `@ramonda/form` mounts two `Form` hooks on one
component in two of its own tests, and a descendant reading its form through the context bound to the
second. Measured — submit the first form and its own `submitCount` is 1 while a descendant `FormState`
reads 0.

**Nothing is declared for it, and `single` is a different axis.** `single` says whether NESTING is a
fault — two on one path, on different components — and a context that welcomes nesting (a theme, a
form) is still broken by two on one component. So this takes no option: there is no version of it an
author would choose. Splitting the keys between two Providers is not a way out either, and the types
already close it — a Provider takes `options: T` whole.

**What replaces it, measured rather than asserted.** A component that renders `this.props.children`
scopes its context to what is inside it, so two of them side by side are two independent scopes and a
consumer in each finds its own with nothing passed down. That works because a context object is created
from the component that RENDERS a node, not the one whose source contains it — so a child handed in as
`children` inherits the wrapper's context. This is React's `<Provider>` element in Ramonda's terms; the
difference is that 1-1 and no fragments mean the wrapper is one real element rather than none. Pinned in
core's `Diagnostics.test.tsx`, because the refusal rests on it.

**`one-provider-per-component` in `@ramonda/check`** says it before anything runs — an ERROR rather than
the usual warning-first, and deliberately: the runtime does not warn either, it throws, and a warning
would call a crashing line survivable. It sees only a pair written directly, resolved through the
`BindingElement` each name came from, so an import alias is transparent and two contexts of the same
shape stay two; a Provider wrapped in a hook class of its own — `Form`, `QueryClientProvider` — is the
runtime's to catch. Zero hits across `apps/docs`, the playground, form, query and router. The pair
resolution moved to `rules/context-pair.ts` now that two rules share it.

`@ramonda/form`'s two tests are restructured onto one form per component, which loses no coverage: "two
forms cannot reach each other's state" and "focus stays inside the form it was submitted from" are
exactly as testable with two components, and that is what an app writes anyway.

Documented where a reader looks: a new section on `/composition/context`, which never taught subtree
scoping at all, plus `/forms/fields` and the RMD056 reference.
