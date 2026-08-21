---
"@ramonda/check": patch
---

The seventy-three fixture tsconfigs share one base instead of repeating it, and a test now proves the
inheritance arrives.

Nothing a consumer installs changes: this is all under `src/__tests__/fixtures`. What changes is the
cost of touching the config. Measured before the edit: 73 files, **0** using `extends`, 52 of them
byte-identical to each other, and the same eight options — `target`, `module`, `moduleResolution`,
`jsx`, `jsxImportSource`, `strict`, `skipLibCheck`, `noEmit` — written out in every one. So raising
`target` was a seventy-three-file edit, and a fixture left behind would not have said so.

Two things stay in each fixture, and neither is a style choice. A relative path resolves against the
config that **declares** it, so `include: ["."]` in the base would mean all of `fixtures/` and every
fixture would pull in every other one; and TypeScript records a `pathsBasePath` per config file, so a
`paths` mapping moved up would resolve one directory too high. `jsxImportSource` is safe to share
because it is a module specifier resolved from each source FILE, not from the config.

**Why it needed a test rather than a run of the suite.** The package's own tsconfig excludes the
fixture directory, so nothing type-checks a fixture — and the analyzer reports what it can see from
whatever options it is handed. Drop `jsx` and every `.tsx` fixture stops parsing as JSX, the rule
under test finds nothing, and the failure reads as a rule that stopped working. So
`fixture-configs.test.ts` asserts the RESOLVED options, through TypeScript's own `extends`, exactly
as `analyze.ts` reads them — and it was planted four ways: a broken `extends`, an option repeated in
a child, `paths` hoisted into the base, and `include` hoisted into the base. Each one fails, naming
the fixture and the option.

The change itself is a no-op, measured rather than assumed: all 73 fixtures were analyzed before and
after and the two dumps — findings, graph, notes, everything `analyzeProject` returns — are identical
byte for byte.
