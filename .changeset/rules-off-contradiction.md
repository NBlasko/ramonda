---
"@ramonda/css": patch
---

Silencing a rule your own config turned on is refused, naming the setting that works.

Three settings reach both a rule and a type, and a rule severity can only reach the rule — so
`rules: { "literal-not-allowed": "off" }` beside `variablesOnly: true` left the error in place and
swapped a message naming your project for `Narrowed<never, Token<…>>`. Only `arity`, which has no
type behind it, silenced completely.

The config now refuses the combination and says which setting to change instead. Silencing a rule
this config did not turn on is unaffected.
