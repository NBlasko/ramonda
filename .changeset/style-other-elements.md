---
"@ramonda/css": minor
---

**`styleOtherElements: false` keeps a block to its own element.** A selector whose subject is another
element — a child (`.title`, `& > img`, `&:hover .icon`) or a sibling (`& + .card`) — is refused
(`styles-another-element`); `&:hover`, `&::before`, `&.active`, `&:has(…)` and `[data-theme] &` still
style the element itself. Left out, nothing changes.
