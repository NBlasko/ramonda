---
"@ramonda/core": patch
---

`/reference/decorators` said `@compute` on `render` "turned the method into a cached property, so rendering
died with `component.render is not a function`". That crash is gone, and what replaced it is worse in the
way that matters.

The method form installs a function now, so `render` stays callable. Measured in a production run, where
the development guard is stripped:

- a state write still reaches the DOM — the render is cached on the signals it read, and state is one;
- so does a props change;
- and a **plain field freezes the page**. The same component without the decorator shows `new`; the
  computed one keeps `old`, because nothing it read had moved.

So the guard exists because this fails **silently**, not because it crashes — the old symptom was loud and
immediate. And the type does not refuse it either: `@compute render()` is exactly the shape `compute`
accepts, which makes `assertNotRender` the only net, and that one is stripped from production.

`__tests__/prod/ComputeOnRender.prod.test.tsx` holds all four measurements, with the undecorated control
beside the computed one — that pair is what makes the freeze a fact rather than an argument.
