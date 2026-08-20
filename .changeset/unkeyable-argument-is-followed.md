---
"@ramonda/check": patch
---

`unkeyable-memoized-argument` follows the argument instead of matching its shape.

Four shapes were planted and all four were silent, and every one of them throws `RMD047` at
runtime:

```tsx
const local = { id: row.id };
this.pick(local);           // an object one line up
this.pick(keyFor(row.id));  // one a helper returns
this.pick(SHARED_KEY);      // a module-level const
this.pick(open ? { id } : "k");
```

The rule stated its boundary as "an identifier could hold a string, and asking what it holds is a
question about types". That is true of an identifier nothing declares; it is not true of one
declared two lines up as `{ id }`. The walk goes to the DECLARATION behind a name, never to its
type, so `this.pick(row)` and `this.pick(row.id)` still look the same from here and both stay
silent.

A module-level `const` counts here and not in `fresh-object-in-props`, which is the one place the
two questions part: that rule asks whether a value is REBUILT, so a module const is the fix; this
asks what a value IS, and an object built once at module scope is still an object.

The walk itself moved to `follow-value.ts`, shared by the four rules that now ask it.
