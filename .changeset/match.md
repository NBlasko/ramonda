---
"@ramonda/css": minor
---

`match` — a value that varies, written as a choice between values that do not.

```tsx
const chip = @@(
  padding: 4px 10px;
  color: match({this.variant}) {
    primary   => $.color.surface;
    secondary => $.color.text;
    _         => inherit;
  };
);
```

**Every arm is its own rule and its own class**, so nothing is built while the page renders — the
subject only chooses between classes that already exist in the stylesheet. That is the whole of why
it exists: variation that can be enumerated stops needing a value on the element.

It is a lookup table, not pattern matching. There is no destructuring, no guard and no custom
matcher; the subject is one expression and every arm is a literal.

- **`_` answers for everything the arms above did not.** With no `_`, a subject naming no arm sets
  nothing at all and whatever was written above it stands — the answer `if ({…})` already gives.
- **The keys are checked against the subject's type**, so an arm for a value it can never hold is a
  fault at the key. Each arm's value is checked against the property, so a fault lands on the arm
  rather than on the match.
- **An arm may not hold a hole** (`hole-in-a-match-arm`), because an arm that carried the render's
  own value would cost exactly what a match exists to avoid. An arm that can never run
  (`match-arm-repeated`) and a match with no arms (`match-with-no-arms`) are reported too.
