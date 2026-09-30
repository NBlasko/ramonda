---
"@ramonda/css": minor
---

`transform-origin`, `perspective-origin`, `vertical-align` and `border-spacing` are longhands now. Some
engine holds each of them as one — the first two in Chromium and Firefox, `vertical-align` in Chromium
and WebKit, `border-spacing` in Firefox — and what the others expand them into is internal or
prefixed, `transform-origin-x` among them. The engines disagree about what they reset, so no split
could match all three. As longhands they sit with every other longhand, and a merge no longer clears
anything when one is written.
