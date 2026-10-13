---
"@ramonda/css": minor
---

`container-without-a-type`: a container's name comes with its type, in one block. `container: card` sets `container-type` back to `normal`, so a size condition asking for `card` never matches — measured in all three engines, even where another rule had set the type. Write `container: card / inline-size`, the two longhands side by side, or `container: card / normal` for a container asked only about style.
