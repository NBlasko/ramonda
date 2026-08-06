---
"@ramonda/core": patch
---

Review pass over the decorator work: three faults found in it

**`@catchError` was reported as a duplicate when a subclass overrode the method and re-decorated it** —
the most natural way to specialise a role, since it keeps the name. The duplicate check looked the
declaration up by NAME, so both the base's and the subclass's resolved to the subclass's prototype and
read as two declarations on one class. It is found by the decorated function's identity now, which is
the only thing that separates them.

**`@catchError` on a hook was refused only at runtime.** `@ShouldUpdateOnPropsChange` rejects it at
compile time through its `This` constraint, and the method decorator had no equivalent — its context
type made `COMPONENT_RUNTIME` optional, so a `Hook` satisfied it. TypeScript refuses it now, and the
throw stays for a build with no types. Note the two report at different moments and always will: a
class decorator when the class is DEFINED, a method decorator at the first instance.

**A dangling doc comment** was left in `Runtime` where the old `shouldUpdateOnPropsChange` field had
been, describing a field that no longer exists.

Also tested rather than assumed: `value`/`checked` through a real server render and back through
hydration, `ErrorBoundary` extended with `super.handleFailure(e)`, a thrown non-`Error`, and that the
order `@Host` and `@ShouldUpdateOnPropsChange` are written in does not matter.
