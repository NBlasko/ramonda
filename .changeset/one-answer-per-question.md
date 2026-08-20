---
"@ramonda/check": patch
---

An audit of the rule set, and one thing it found: **"what is this member called" was answered in seven
places, under two names.**

Four rules held a named function for it — `memberName` in `render-reach`, `server-env-in-shared-code` and
`row-reads-a-plain-field`, `nameOf` in `stale-field` — and three more wrote the expression inline. Both it
and `decoratorName`, which had two copies, now live in `syntax.ts`, whose whole description is functions
that "answer one question about a node and take no context to do it".

Nothing had drifted yet. What makes this worth doing rather than tidying is that the last two copies of
one judgement DID drift, within a day of each other, and the second one was wrong in four ways — each copy
passing its own fixture the whole time. `scripts/dev/find-duplicate-helpers.mjs` finds the next one in a
second; run it after adding a rule.

**The consolidation itself exposed a live one.** In `interval-with-no-cleanup`, the member's name and the
interval variable's name are both natural to call `named`, and renaming the outer one to match its new
import made `member:` carry the interval's name instead. Only the `| undefined` on one of them made it a
type error rather than a wrong report.

**What else the audit checked, all clean:** every one of the 56 rules is named by a test; no rule mentions
an `RMD` code in prose that it should have declared as `alsoReportedAs` (all three mentions are
contrasts — `RMD010` watches something narrower, `RMD043` a different case, `RMD020` a consequence); every
rule's tests bound their output rather than only asserting positives; the one rule with a `needs` gate can
open it; and no two rules report one line as the same fault — the sixteen shared lines are dense fixtures
where two independent faults sit together.
