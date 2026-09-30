---
"@ramonda/css": patch
---

`narrower-after-a-whole-shorthand` across blocks sees a `$` variable: `...{base}; border-top: $.border.top`
after a base holding `border: $.border.thin` is reported, as it already was with `var()` written out.
A variable inside a value, `1px solid $.color.a`, counts too.
