---
"@ramonda/css": minor
---

`invalid-value`: a value its property's grammar cannot read is reported, function arguments included — `rgb(1x 2 3)`, `linear-gradient(redx, blue)`, `cubic-bezier(0.4 0, 0.2, 1)`, `transform: rotate(45)`, `aspect-ratio: 16  9`. Every browser drops each of them. It speaks only where no more precise rule did, and leaves alone a value with `var()`, a vendor's own word, and a property whose type already says what it takes.
