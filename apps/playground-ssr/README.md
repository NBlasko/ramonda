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

## The smoke test, and why it must not need an editor

`npm test` builds the bundle and runs `scripts/smoke.mjs`: the server renders `/`,
the real client bundle is loaded into jsdom, the devtools panel is driven the way a
reader drives it, and the `__open-in-editor` endpoint is called with a path taken
out of the bundle's own sourcemap.

**That last one is the part with a trap.** Opening a file needs an editor, and
`launch-editor` finds one from `$EDITOR` or by guessing from the process table — so
a developer with an IDE running gets a `200`, and a CI runner with neither gets a
`500`. This test asserted the developer's desktop for a while and went red on the
first push.

What it asserts now is what the endpoint is actually for: **the path resolved.** An
unresolvable path is refused with `422` *before* any launch is attempted, so
reaching the launch at all is the proof. A `500` saying "no editor found" therefore
passes, and a `422` still fails — and the test makes a second request for a file
that does not exist to prove that the refusal path is alive, because accepting a
`500` must not turn into accepting anything.

To run it in a runner's conditions — no `$EDITOR`, and nothing to guess from:

```bash
mkdir -p /tmp/fakebin && printf '#!/bin/sh\nexit 1\n' > /tmp/fakebin/ps && chmod +x /tmp/fakebin/ps
PATH="/tmp/fakebin:$PATH" EDITOR="" VISUAL="" npm test
```

Shadowing `ps` is the part that matters; clearing `$EDITOR` alone is not enough,
since the guess from the process table finds your editor anyway.

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

It built cleanly before that only by accident: `esbuild.jsxInject` put an import
into *every* module, which forced each one through the esbuild transform, and
that transform is what removes the decorators. Nobody chose it, and taking
`jsxInject` away — as this app had to, because injecting `import { h }` into
`packages/core/src/vdom/h.ts` collides with the `h` it declares — brought the
decorators back, in silence.

What actually decides it is `target`: esbuild compiles decorators away for every
value except `esnext`, which is also its default. So both bundles here are built
with esbuild and an explicit target, and `ramonda-check-bundle` parses what comes
out. A generated project gets the same settings from `@ramonda/build` without
naming any of them.
