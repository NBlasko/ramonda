---
"@ramonda/css": minor
---

`ramonda-css explain <property>` — what your config does to one property, and which line decided it.

```
$ ramonda-css explain border-radius

  border-radius   a length or a percentage

    shorthand      false        "*"
    arity          1            "*"
    variablesOnly  false        "border-radius"   overriding "<length>"
    units          px, rem      "<length>"

  from ramonda.css.ts
```

`properties` is keyed by three selectors now, each binding more tightly than the one before, so
knowing what applies to one property meant reading three entries and holding CSS's own
classification in your head.

It walks the same selectors as the merge the compiler reads, in the same order, and a test asserts
the two agree over every property CSS classifies — an explanation that drifted from what is enforced
would be worse than none, because it would be believed.
