---
"@ramonda/css": patch
---

`@@property`, `@@keyframes` and `@@font-face` type-check again in a project that declares variables.

A generated `css-system/index.ts` replaces the shipped property map for every file under it — that
is how a project's own settings reach a block — so a type it does not pass on stops existing. It
passed on four and dropped seven, and three of those seven are the shapes a named block is checked
against:

```
TS2694: Namespace '…/css-system/index' has no exported member 'CssPropertyDescriptors'
TS2694: … 'CssKeyframesShape'
TS2694: … 'CssFontFaceDescriptors'
```

The same file with no config had no problems at all, so what broke them was declaring a variable —
the one thing the feature asks people to do.
