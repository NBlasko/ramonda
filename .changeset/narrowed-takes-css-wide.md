---
"@ramonda/css": patch
---

A narrowed block prop takes the CSS-wide keywords: `{ color?: Token<"color"> }` accepts
`color: inherit`, `initial`, `unset`, `revert` and `revert-layer`, inside a state too. Nothing
else is let through: another value, `!important` and a property outside the list are still refused.
