---
"@ramonda/core": patch
---

The reconciler's whole-list skip is removed: it could never fire, and it must not

`reconcileChildren` compared last pass's BUILT `ListNode` with this pass's `list()` descriptor. The
descriptor is a fresh object on every render, so the two were never the same and the branch never
ran. Measured at 1000 rows with a stable callback and an unrelated state change: zero DOM mutations,
zero row renders, and the reconciler walked every row.

Comparing the built node instead makes the skip fire, and makes a list inside a row stale: categories
whose rows list products priced in `this.currency`, and a change of currency keeps the outer array
and callback, so the outer region is skipped and every price keeps the old currency.
`ListCallbackIdentity.test.tsx` ("BOTH stable") fails on that change. The walk is what reaches the
inner list, so it stays, and the comments that promised the skip now say so. The engine's own skip —
the same array and callback hand back the same node, and no callback runs — is unchanged.

`ListRegion.source` existed only for this comparison and is gone with it.
