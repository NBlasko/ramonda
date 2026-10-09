---
"@ramonda/css": patch
"@ramonda/check": patch
---

**TypeScript 7 is refused with a sentence, not a crash.** TypeScript 7 has no JavaScript API — its
package exports its version and nothing else — and both tools read source through that API. Under
7.0.2, `ramonda-check` stopped while loading on *Cannot read properties of undefined*, and so did
`ramonda-css` and a build with a `ramonda.css.ts`, none of it naming TypeScript. Each now says which
TypeScript is installed and to install 5 or 6; the peer range is `<7`, so npm refuses the install
first. TypeScript 6 is unaffected.
