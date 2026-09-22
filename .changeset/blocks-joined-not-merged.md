---
"@ramonda/css": minor
---

**Two style blocks joined into one string are reported.** `mergeClassNames` is what was meant.

```tsx
<div className={`${base} ${card}`} />     // reported
<div className={mergeClassNames(base, card)} />  // the answer
```

A block is a string, so a browser takes the join. What it does not do is MERGE: every class from
both lands and the stylesheet breaks the tie, so a declaration one of them meant to override
survives. Measured:

```
base = padding-left: 40px    card = padding: 8px

merge   panel r-cur-pointer r-disp-flex r-p-8px
join    panel r-pl-40px r-cur-pointer r-disp-flex r-p-8px
```

`r-pl-40px` should have been cleared by the `padding` written after it — which is what CSS's own
cascade does at a call site, and what a merge exists for. The page renders with one declaration too
many, and nothing said so.

**It only became reachable when the `css` prop went.** The brand already refuses a joined string
where a BLOCK is wanted — a template of two blocks cannot be spread into another block — but
`className` takes a plain `string`, and a block is a string, so the one place it matters is the one
place the type cannot speak.

Three spellings, one rule: a template, a `+` chain, and `[a, b].join(" ")`.

**What it does not report**, because the ordinary case must stay quiet:

- **One block beside a class of your own.** `` `lead ${card}` `` is correct and is what the
  documentation teaches — a foreign class keys on itself, so merging it changes nothing. Measured:
  the two give the same string byte for byte.
- **The same block twice.** `` `${card} ${card}` `` duplicates classes, a duplicate class does
  nothing, and no declaration overrides another — so the message would be false for it, and a
  message that is false on the case it fires on is a false report however the rule is phrased.
