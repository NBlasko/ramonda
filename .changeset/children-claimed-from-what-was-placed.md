---
"@ramonda/core": minor
---

An element's children are claimed from what Ramonda placed, not read back from the page

An update read every element's `childNodes` back from the page to find which child is which. An element
now keeps the children the diff placed in it, and the next update starts from that, as its attributes
are compared with what was written on them. A child someone else added stays where they put it — as an
attribute someone else set does — and children someone else moved keep the order they were moved to. When
one of the element's own children is gone — taken out, or replaced by writing `textContent` — the next
render that changes those children reads the page, as before, and puts it back.
