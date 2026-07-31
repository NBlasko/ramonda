---
"@ramonda/core": patch
---

Why the devtools import lives in your app and not in `bootstrap`, with the measurement.

Asked: the one line every app writes — `if (import.meta.env.DEV) void import("@ramonda/devtools")` —
would be cleaner inside `bootstrap`. It cannot go there, and the reason is now recorded in core and on the
devtools page rather than left as folklore. Measured on an app that has **not** installed the panel, which
is most apps:

```
vite build   →  "[vite]: Rollup failed to resolve import "@ramonda/devtools""   the build FAILS
esbuild      →  bundles, leaving import("@ramonda/devtools") in the output      fails at runtime
```

So a literal specifier inside core would break `vite build` for everyone who does not use devtools, and
ship an unresolvable bare specifier for everyone who uses esbuild. Core's speculative import therefore
keeps its **variable** specifier plus `@vite-ignore`, which no bundler rewrites — meaning the browser
would have to resolve a bare specifier itself, and it cannot.

Only the app can load the panel: it is the one that knows the package is installed, and its bundler is the
one that can resolve it. Nothing changed in the code; what changed is that the next person to ask gets an
answer with numbers instead of an assurance.
