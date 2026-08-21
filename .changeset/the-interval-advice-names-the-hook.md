---
"@ramonda/check": patch
---

`interval-with-no-cleanup`'s advice names the `Interval` hook for an interval the app starts.

The rule reports a `setInterval` nothing can clear, and its advice offered two answers: `@interval`,
which starts at mount, or a raw timer whose id lives on a class property. The first does not fit an
interval that starts on a click, so every such case landed on the second — and the second is the
shape the rule exists to catch when it is done half way.

`Interval` is the answer for that case now, so the advice offers it first and keeps the property
fallback for a timer the app really does want to own.
