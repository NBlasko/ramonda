---
"@ramonda/core": minor
"@ramonda/router": minor
"@ramonda/testing-library": minor
"create-ramonda": minor
---

JSX goes through an automatic runtime, and the factory is renamed `__h`

Setting Ramonda up used to mean naming a factory (`jsxFactory: "__ramondaH"`), injecting it into
every module, and declaring it in a `global.d.ts` — and then holding two names in your head, because
the package exported `h` while compiled JSX called `__ramondaH`.

Now the compiler imports what it needs, per file:

```jsonc
{ "jsx": "react-jsx", "jsxImportSource": "@ramonda/core" }
```

```js
esbuild: { jsx: "automatic", jsxImportSource: "@ramonda/core" }
```

No factory name, no `jsxInject`, no `jsx-shim.ts`, no global declaration. `npm create ramonda`
writes it this way, and both templates lost a file each.

**Breaking.** `h` is no longer exported; the factory is `__h`, for the vnodes a tag cannot express —
a runtime tag name, spread children. Compiled JSX never calls it. To migrate, change the two config
keys above, delete the inject and the global declaration, and rename any hand-written `h(` to `__h(`.

Two new subpaths ship with core: `@ramonda/core/jsx-runtime` and `@ramonda/core/jsx-dev-runtime`.
Both are needed — every bundler's development mode imports the second one.

Fragments still do not exist. `<>…</>` throws with the reason rather than half-working, because one
tag producing several elements is what the one-tag-one-element rule is about.
