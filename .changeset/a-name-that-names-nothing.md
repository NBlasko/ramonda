---
"@ramonda/check": patch
---

An empty naming attribute no longer answers for the name it lacks

`<input type="text" aria-labelledby="" />` has no accessible name at all, and was reported by
**nothing**: the attribute that names nothing had answered for the one that would have.
`aria-label=""`, `title=""` and whitespace behaved the same way. A screen reader announces every one
of them as "edit, blank" and stops.

It is the same shape as `placeholder=""` two branches above it in the same reader, found the same
way and fixed the same way: **when a rule reads an attribute's PRESENCE as its meaning, ask what it
SAYS.** Three answers and not two — written with something, written empty, and unreadable.

A name this cannot READ still counts. `aria-label={t("email")}` is somebody naming the control and
guessing at the string would report one that is correctly labelled; only an empty literal is the
source settling the question the other way.

Found by planting a broad sweep of obviously-wrong markup and reading which lines nobody spoke
about — the ladder's own method, pointed at the gaps BETWEEN rules rather than at one rule's shapes.
That is the second finding from that sweep; the first was the empty `<button>`.
