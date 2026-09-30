---
"@ramonda/css": minor
---

An arm of a `match` on a shorthand now splits like any other declaration:
`padding: match({size}) { small => 4px; large => 8px 16px; }` picks `r-p- r-pt-4px r-pr-4px …` rather
than one `padding` class. An arm that cannot split — one holding a `var()` — keeps its shorthand, and
the other arms still split.
