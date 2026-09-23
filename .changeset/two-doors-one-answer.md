---
"@ramonda/css": patch
---

**A rule switched off in `ramonda.css.ts` is off for the checker as well as the build.** It had just
become off for the build, and `checkSource` — which `ramonda-css` and your editor read — kept
reporting it.

`checkBlock` has been handed the config since it took one. The SITE checks never were, in either
door, so `unknown-named-block` and `block-as-a-jsx-attribute` ignored the key their own message
names. That was fixed for the build in this same release and not for the checker, which left the two
disagreeing:

| `rules: { "unknown-named-block": "off" }` | before |
|---|---|
| the build | compiled |
| `ramonda-css`, and the editor | still reported it |

Both now read the key. The test asserts the two doors AGREE rather than checking each alone, because
that is the property: either tool moving on its own is the fault.
