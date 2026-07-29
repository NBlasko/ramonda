---
"@ramonda/devtools": patch
---

The full value view was drawn under the sticky header.

The sticky toolbar and breadcrumb were `z-index: 4` and the value view was `3`, so opening a value
put the controls on top of it and cut the tree off two rows in. The panel's layers are now a
documented scale — resize handle `2`, sticky head `4`, value view `10` — with the gap left
deliberately, so the next sticky thing added cannot climb over the value view by accident.

There is a test for the order now. Every other test in this package reads structure or classes, and
neither can see a z-order.
