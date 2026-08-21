---
"@ramonda/core": patch
---

Every package and app extends one `tsconfig.base.json`, and three type checks that thirteen of them
were missing are now on for all of them.

Nothing published changes — these are the configs the build reads, not anything shipped. What changes
is that a config edit is one file instead of seventeen, and that the floor is the same everywhere.

**The duplication was the smaller half.** Measured across the seventeen: only FOUR options were
identical (`module`, `moduleResolution`, `skipLibCheck`, `strict`). The rest had drifted, and the drift
was not a set of decisions — **thirteen projects got none of `noUnusedParameters`,
`noImplicitOverride` or `noFallthroughCasesInSwitch`**, while `core`, `dom-facts` and `theme` got all
three and `devtools` got two. The blocks were copied at different times, so the strictness a package
happened to be checked at was an accident of when it was created.

Turning those three on for everyone cost **two errors across fourteen projects, and both were real**:
an unused parameter in `duplicate-key-among-siblings`, and — in `InheritanceDemo`, the demo that
TEACHES inheritance — a method overriding its base without `override` (`TS4114`). The demo says why
the keyword matters now, which it could not before.

`noUnusedLocals` is deliberately NOT in the base: measured at **103 errors**, and they are not dead
code. Nearly all are `const provider = …` in tests, built for a side effect and never read on purpose.
The three packages that want it keep it themselves.

`scripts/check-tsconfigs.mjs` joins the gate and is planted three ways: a config that stops extending
the base, one that re-declares what the base already sets, and a typo in the `extends` path — which is
the quiet one, because a bad path is not an error, it is a config that silently sets nothing.
