---
"@ramonda/devtools": minor
---

Bigger type, and a full view that tells you it has gone stale.

**Every font size moved up a step** (9 → 10.5, 11 → 12.5, 12 → 13, 12.5 → 14). The panel was sized
for a 900px drawer read at a glance; it is something you dock at 620 and read for minutes now, and
the smallest text in it was the keys and the values — the text you actually read. A test holds the
floor at 10.5px.

**The full view is still a snapshot**, because a tree that moves while you are four levels into it
cannot be read. But a snapshot that has quietly gone stale is a lie, so there is a `refresh` button
that stays dim while the value it was opened with is current, and lights up and pulses once the app
has written a different one. Click it and you see the new value — 194 products instead of 8 —
with the size in the title updated. Nothing repaints until you ask.

Compared by contents, not identity, so a rebuilt-but-equal value does not light it. If the value is
gone entirely — the component unmounted, the entry was collected — the button says so and keeps the
last snapshot rather than refreshing to an empty tree.
