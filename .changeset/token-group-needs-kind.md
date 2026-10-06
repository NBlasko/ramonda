---
"@ramonda/css": patch
---

**A token group written without `kind( … )` is refused.** `tokens: { $color: { accent: "#10b981" } }`
loaded, declared nothing and wrote an empty sheet — the first `$color.accent` was then told the
project declares no tokens. The config's type now takes only what `kind( … )` makes, and loading the
config names the group: *declares `tokens.$color` without `kind( … )`*.
