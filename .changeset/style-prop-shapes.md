---
"@ramonda/css": patch
---

`style-prop-never-used` no longer reports a prop that is used.

Six shapes a real component takes were put through the rule, and three were false reports: a prop
destructured under another name (`const { css: mine } = props`), a prop handed to an ordinary
function that takes a block, and one read through a getter. All three are ordinary code and all
three were told their prop was never used.

- A use is now **any expression whose contextual type is a block**, whatever position it is written
  in — a JSX attribute, a property in an object, an argument to a function. Asking the position's
  kind instead is what missed the third.
- A getter's body is followed, as a method's already was.
- A destructured binding is linked to the property it came from, through the thing being
  destructured rather than the declaration holding the pattern — for `const { css: mine } = props`
  that declaration's type is `any`, which had no properties to match.
- And a destructured **local** is no longer a subject of its own, so the shape above is reported
  once, about the prop, rather than twice. An unused local is `noUnusedLocals`, not this.

`style-prop-overridden` reports a declaration once however many spreads promised what it clears. It
looped per spread, so two spreads reported the same declaration twice at the same character.
