---
"@ramonda/css": patch
---

- **A registered property only an animation sets is no longer reported as set by nothing.** A
  `@@keyframes` frame writing `$(angle): 90deg` sets it on the element it animates, and
  `registered-never-set` now counts that — it reported the very pattern the docs show for animating
  a registered property.
- **A relative `url( … )` in a block builds through esbuild.** It failed with *Could not resolve*
  with the file right beside the source: the block's stylesheet had no folder to read the path from.
  It is read from the folder of the file that holds the block, as Vite reads it.
