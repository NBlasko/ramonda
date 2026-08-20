---
"@ramonda/check": minor
---

Three rules read one class body where the fault spans a base class and its subclass. Found by
planting the shapes each rule's claim implies and measuring, then checking the answer against what
core does at runtime.

A component's fields initialise base-first, on ONE instance, so what a base declares is the
component's as much as what it declares itself.

- **`one-provider-per-component`** missed a Provider inherited from a base beside one mounted here.
  Measured in core: that pair **throws `RMD056`** — "a component publishes a context on ONE object" —
  and the rule that exists to say so before it ships said nothing. The report now names the base the
  first one came from, because a line number in another file does not.
- **`context-consumed-above-its-provider`** missed a consumer inherited from a base, which is
  *always* above a provider mounted here. Measured: core reports `RMD057`. Two halves in two class
  bodies are ordered by the chain now; two in one body are still ordered by source position.
- **`interval-with-no-cleanup`** reported an interval the component does clear, when the
  `clearInterval` is on a base — a false positive on the documented shape. The chain is read upward
  now.

The chain is walked upward only, and that decides one deliberate silence: a class cannot know who
extends it, so an **abstract** class keeping a timer id on a property is no longer reported. It is
never mounted on its own, and any subclass may be the one clearing it. A concrete base keeps its
report — `<Base />` alone really does leak — and an id kept nowhere or in a local stays certain
either way, because no subclass can reach either.

`heritage()` is exported from `render-reach` rather than copied three more times; it was already the
answer to this question for `render()`'s reach and for `@state`.
