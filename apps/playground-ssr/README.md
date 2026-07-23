# playground-ssr

A Ramonda app rendered by a **real Node process**, so SSR and hydration can be
observed instead of simulated.

```bash
npm run dev      # build both bundles, then serve on :5180
```

| URL | renders |
| --- | --- |
| `/` | Home, with a counter that only works after hydration |
| `/about` | a second route, so the server has to choose |
| `/users/42` | the `:id` param, resolved server-side |
| `/nope` | the 404 route |

## Why it exists

Every SSR test in the repo runs in one jsdom, in one process, with state blobs
injected by hand. That hides a whole class of bug: anything that is per-process
on the server and absent on the client. The `AsyncLoad` hydration crash was
exactly that, and reproducing it in a test needed a **forged** state blob.

## The two checks it carries

**Adoption**, in `index.html`. Open any page with the console visible and it
prints one line:

```
[ADOPTION] adopted — served=24  elements-rebuilt=0  dropped=0  text-split=2
```

`elements-rebuilt` and `dropped` must both be **0** — that is hydration adopting
the server's DOM instead of quietly rebuilding it, which is the question this app
was built to answer. Rebuilding would not look like a bug: the page renders
correctly either way, which is exactly why it needs measuring rather than
eyeballing. `text-split` is expected and harmless: HTML cannot record where one
text node ends, so `User {id}` arrives fused and hydration splits it back apart,
minting one node per split. The comment above the script explains the mechanism
and records the numbers as of 2026-07-19.

**Diagnostics**, via `measure-hydration.mjs`. With the server running:

```bash
node measure-hydration.mjs /users/42
```

It fetches the page over HTTP from the separate process, hydrates it in a fresh
jsdom, and counts every RMD diagnostic; the exit code is non-zero if any fired,
so it can gate a build. This is what confirmed the RMD007 fix — and note that a
silent run proves nothing on its own. Verify a fix by A/B: show the same
instrument firing before it, or a check that quietly stopped working looks
identical to a bug that is gone.

## How the router is seeded

It is not. The router reads `window.location`, and the server points its DOM
shim at the request URL before rendering — so the ordinary code path produces
the right page. There is deliberately no server-only entry into the router: a
second way to say "you are at /users/42" would be a second thing to keep honest.

## Why esbuild and not vite

**Vite's pipeline does not reliably transform TC39 decorators.** Node cannot
parse `@Host("div") class …`, and neither can a browser — the built bundle threw
`Uncaught SyntaxError: Invalid or unexpected token` in Chrome, from a decorator
that survived minification inside `AsyncLoad`.

`playground-core` builds cleanly only by accident: its `esbuild.jsxInject` puts
an import into *every* module, which forces each one through the esbuild
transform, and that transform is what removes the decorators. Take `jsxInject`
away — as this app had to, because injecting `import { h }` into `packages/core/
src/vdom/h.ts` collides with the `h` it declares — and the decorators come back.

esbuild transforms them reliably, so both bundles are built with it. See BUGS.md,
"TC39 decorators survived the bundle".
