---
"@ramonda/css": minor
---

Three settings the types enforced and the build ignored now reach both.

Vite and esbuild run the rules over a block and never type-check it, so a setting that only reached
the types was one the dev server served anyway:

```
properties["*"].units          padding-left: 2rem    checker refused, build served
properties["z-index"].values   z-index: 5            checker refused, build served
properties["*"].shorthand      padding: 8px          checker refused, build served
```

The project-wide `units`, `arity` and `variablesOnly` already spoke in both, so half the config was
enforced everywhere and half in one place with nothing saying which.

Two new rule ids: `value-not-allowed` and `shorthand-not-allowed`. Per-property `units` joins
`unit-not-allowed`. Each names the setting and the way out, and the compiler's word on that line is
dropped so you meet one report rather than two.
