---
"@ramonda/css": patch
---

A property typo reaches the build, and a unit is reported once.

**`dsiplay: flex` compiled.** `unknown-property` reported dashed names only, because a bare one
already had TypeScript's `TS2561` with its own *did you mean*. That held in the checker and not in
the build — vite and esbuild run the rules and no TypeScript at all, so a plain typo and even
`zzz: flex` reached the stylesheet with nothing said anywhere.

The rule speaks for both now, with or without a suggestion, and the compiler's word on the line is
dropped in the checker and in the editor — so it stays one typo, one report.

**And `units` said twice was reported twice.** The top-level `units` and the one inside `properties`
are different mechanisms with one name; setting both named the same value twice. Two different units
in one value are still two findings.
