---
"@ramonda/check": patch
---

Three rules claimed more than they caught. Found by auditing each claim against the code and
planting the shapes the claim implies.

**The reach stopped at the class's own members.** `this.helper()` was looked for in `cls.members`
and nowhere else, so a method **inherited from a base class** was never followed and the walk ended
there without a word — and `stateFieldsOf` read only the class's own fields, so `@state` declared on
a base was not state as far as the rule was concerned. Both were gaps rather than decisions: a base
is another **class** and the same **object**, so `this` still means the component and inherited state
is the component's. A `render()` reaching a write through an inherited method now reports it, path
and all. The file's own docstring listed this among the things it deliberately could not see; that
line is gone, because it is no longer true.

Measured while checking: the walk's other reaches are sound — four helper hops inside a class, and a
clock three files away through two intermediate functions, both reported with the full path.

**`persist-of-a-lossy-value` did not look inside a literal.** `@persist opened = new Date()` was
reported while `@persist meta = { openedAt: new Date() }` was not — and the second is the commoner
shape by a distance. Its runtime twin `RMD033` recurses for exactly that reason and says so; the
static half was written shallow and claimed the same thing. It now recurses into object and array
literals, bounded at four as the runtime check is.

**`link-without-a-destination` missed an empty `href`.** The claim is "one that goes nowhere"; the
code enumerated `#` and `javascript:`. `href=""` is worse than the bare `#` rather than the same —
it resolves to the page it is already on, so following it **reloads**, losing whatever the reader
had typed and scrolled to. It has its own sentence now.
