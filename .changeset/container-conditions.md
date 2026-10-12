---
"@ramonda/css": minor
---

`@container` conditions are checked as `@media` ones are, against a container's own features — `width`, `height`, `inline-size`, `block-size` and `aspect-ratio`, with `min-` and `max-`, and `orientation`:

- `unknown-container-feature`: `(min-widt: 40rem)`, and a media feature such as `(hover: hover)`, which a container never matches.
- `unknown-container-value`: `(min-width: 40)`, `(min-width: 40remx)`, `(orientation: protrait)`.
- `malformed-container-condition`: `(min-width 40rem)` with no colon, `3e0m`, a word that is not `and`, `or` or `not`.
