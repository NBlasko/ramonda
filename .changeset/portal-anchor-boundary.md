---
"@ramonda/core": minor
---

A portalled subtree survives a re-render, and a component inside a portal restores its server state.

**Fixed:** a `Portal` marked its own tags with a `data-ramonda-portal` attribute, and the server emitted whatever carried it. An attribute cannot survive on a node the reconciler owns — the attribute diff reads a node's current attributes as the previous set and removes whatever the next vnode does not have — so the first re-render of anything in a portal's block erased the marker and the tag left the page silently. Any state write did it. A portal's block is now delimited by comment anchors, which no attribute pass can reach.

**Served markup changes** for portals: `<!--r7-->…<!--/r7-->` around the block instead of `data-ramonda-portal` on each tag. `Head` is unaffected — it builds its own tags outside the reconciler and keeps the attribute.

**New:** hydrating a portal runs the ordinary `hydrateLevel` walk over its block, so a component inside a portal is hydrated rather than rebuilt — its server state is restored, its host adopted. Server state blobs are now stamped inside portal blocks too; they only ever covered the body container.
