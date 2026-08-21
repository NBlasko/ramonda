---
"@ramonda/check": patch
---

Seven defects found by reviewing this branch, five of them in code it added.

- **`self.location.pathname` was reported on a component reading its own field.** `browser-url`
  accepted `window`, `document`, `self` and `globalThis` by NAME, and `self` is the one of the four
  that is routinely a local — `const self = this` is an ordinary line, and `(self) => …` is this
  framework's own convention for a `@Host` props callback. Three rules asked "is this the global"
  three different ways and two were wrong in opposite directions; `rules/globals.ts` answers it once.
- **A `@StableProps` core declares on its own hook was invisible**, so `fresh-object-in-hook-props`
  reported a `meta` array that `Head` has DECLARED stable — reporting the fix, on the framework's own
  hook, in `apps/playground-ssr`. Core imports its decorators relatively, so nothing in `Head.ts`
  names `@ramonda/core` at all. A declaration is core's when it lives in the package called
  `@ramonda/core`, read from `package.json` rather than from a path.
- **`export * from "@ramonda/core"` silenced every class rule.** A star export resolves straight to
  core's own declaration, which names no module, so the specifier chain had nothing to walk — and
  `hasDecorator` is the chokepoint they all read through. The package test answers this one too.
- **A listener added on `window` and removed on `globalThis` was reported as uncleaned.** They are
  one object; the removal set was keyed on the spelling. That is the `@ramonda/query` and
  `@ramonda/form` devtools shape with one word changed. A removal whose event name cannot be read
  now also silences the add, which is the care the add side already took.
- **`foundIn` printed the outermost name**, which is the opposite of what the field documents.
  `@persist blob = wrap()` where `wrap()` returns `{ cache: makeCache() }` named `wrap` — already on
  the line being read — instead of `makeCache`, where the reader has to go.
- Eight fixture configs carried two `"paths"` keys after the merge, so the second silently won and
  the `@ramonda/core` mapping was discarded. Four vendor fixtures never needed one.
- The note added to `render-reach` overstated its case: a handler CAN be a call argument —
  `onclick={debounce(() => { this.n += 1 }, 100)}` is reported — and the docstring now says so
  rather than generalising from the returned-handler shape.
