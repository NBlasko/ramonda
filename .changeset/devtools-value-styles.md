---
"@ramonda/devtools": patch
---

The value tree and the full view had no styles at all.

Every class was rendered and none of them was in the stylesheet: a patch anchored on a selector
that had since been reworded, so the section was never added. The markup was right, which is why
33 tests passed while the buttons were browser defaults, the tree had no colours, and nested rows
had no indentation to read the nesting from.

Styled now: coloured keys and types, the panel's own disclosure triangles, `⤢` as a chip that
brightens with its row, and the full view's `raw`/`copy`/`×` as real controls — `raw` looks held
down while it is on, `×` is the only one that turns red, since it is the destructive one and the
one hit by accident. Both tabs share it, because both render the same tree.

`⤢` also sits in the same place in both tabs now — on the label of the value it opens — and a tree
no longer starts flush against the edge of its box.

And a test that would have caught it: the panel is rendered, every class it emits is collected, and
each one is looked up in the stylesheet. Structural tests cannot see a missing rule; this one can.
