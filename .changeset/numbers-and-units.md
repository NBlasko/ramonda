---
"@ramonda/css": minor
---

Three more kinds of value every browser drops are reported:

- A unit is read the way CSS reads one, digits included: `width: 1p0x` is `1` with the unit `p0x` (`unknown-unit`), and `100%x` is the unit `%x`.
- `malformed-number`: `opacity: 0.` — a decimal point with no digit after it.
- `unit-of-the-wrong-kind`: a real unit of a kind the property does not take — `z-index: 2x` (`x` is a resolution), `width: 2s`, and in a shorthand through the longhand it lands in, `margin: 0x auto`. The table is measured in Chromium, Firefox and WebKit.
