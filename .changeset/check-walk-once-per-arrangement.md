---
"@ramonda/check": patch
---

`ramonda-check` walks the component tree once per arrangement instead of once per path. A tree where components mount the same children from many places had every path walked: the documentation site, at 368 components, took 9.5 s to check, and now takes 3.2 s. A build runs the check first, so every build paid it. The findings, the graph and `--certify` are unchanged — compared byte for byte on every app in this repository.
