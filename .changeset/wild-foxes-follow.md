---
"@ramonda/router": patch
"@ramonda/testing-library": patch
---

Follow core's lifecycle decorator rename

Both packages use the lifecycle decorators in their own source — `@created({ env: "client" })` in the
router's navigation counter, `@mounted` and `@destroyed` across the testing library's harness — so both
had to be republished with the new names.

**A published copy of either will not work with the renamed core.** They declare core as a peer with a
range wide enough to admit it (`>=0.1.0 <1.0.0`), and that range cannot express "only the versions where
these names exist", so npm will happily install the pair and the import fails at load with
`create is not exported`. Upgrade the two alongside core rather than one at a time.
