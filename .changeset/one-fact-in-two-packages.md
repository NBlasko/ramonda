---
"@ramonda/check": patch
---

The analyzer's advice about a doubled decorator is checked against core's runtime instead of trusted.

`@ramonda/check` tells a developer what writing `@StableProps` twice does — "they MERGE, both take
effect, nothing is lost" — and that sentence lived in the analyzer while the behaviour lives in core.
**The analyzer does not import core**, deliberately: it reads source with TypeScript and never loads the
framework. So the two could disagree and nothing would notice. Change core so a second `@StableProps`
throws and the analyzer would keep advising that it merges.

The quiet direction is the worse one. A new single-use decorator in core that the rule never learns
about is not a wrong report, it is SILENCE — and silence is what an analyzer is trusted for.

Three links, none of them a shared dependency and none of them new published surface:

1. Core's diagnostic carries the fact as data: `duplicate: { decorators, effect }` on the five codes
   about a doubled decorator (`RMD045`, `RMD032`, `RMD040`, `RMD046`, `RMD050`).
2. `scripts/check-decorator-duplication.mjs` reads both tables from source with the TypeScript AST —
   the same reason `check-api-coverage.mjs` reads `SPECS` from source — and fails the build if they
   differ either way, or if a duplication code exists that no rule claims. Planted four ways: core
   changing an effect, core gaining a decorator, the rule claiming one core does not describe, and an
   unclaimed code.
3. `DuplicateDecoratorSpecs.test.ts` in core closes the hole the script cannot see: a MISSPELLED name.
   `["catchErrors"]` in both places agrees perfectly, passes the script — measured, it prints "agree on
   all 8" — and describes a decorator that does not exist, so the rule reports nothing. The test reads
   the real export list rather than a second list of names.

The rule's four `Set`s became one `EFFECT` map on the way, which says the same thing once and is what
made the comparison trivial. Its 125 tests are unchanged.
