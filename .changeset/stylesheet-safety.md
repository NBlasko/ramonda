---
"@ramonda/css": patch
---

A declared name or value that would break the generated stylesheet is refused.

Neither was checked. The emitted module parsed in every case; the CSS did not, and two of these mean
something other than what they say:

```
value `a;b`   →  --a-b: a;b;     the `;` ends the declaration, `b;` is left over
value `a}b`   →  --a-b: a}b;     the `}` CLOSES `:root`, and every later variable escapes the rule
a newline     →  --a-b: a        the value is cut in half
name `b*c`    →  --a-b*c: 8px;   not a custom property name at all
name `b"c`    →  --a-b"c: 8px;   nor this one
```

The permitted name set is not invented: the editor's grammar matches a `$` path as
`(?:\.[A-Za-z0-9_-]*)+`, so a segment outside it is a variable `$` could never reach — codegen was
writing one anyway.

A dot in a key still reads as nesting, which works and is now written down.
