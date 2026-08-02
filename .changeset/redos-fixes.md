---
"@ramonda/router": patch
"@ramonda/check": patch
"@ramonda/devtools": patch
"create-ramonda": patch
---

Two regular expressions replaced with linear scans. Both were the same shape — `+` anchored at
`$`, which cannot match when the string does not end in the run it is looking for, so the engine
retries from every position and backtracks the whole run each time.

**`normalizePathname` (router)** is the one that mattered: it reads
`window.location.pathname`, so the string comes from whatever URL someone was handed. Measured on
`"/".repeat(n) + "a"` — 30k slashes took 942ms, 60k took 3.7s. A link with enough slashes hung the
tab that opened it. The scan handles 200k in about a millisecond.

**`create-ramonda`** trimmed dashes off a derived package name the same way (`/^-+|-+$/g`); only a
folder name reaches it, but it is published source, and two loops are the right way to trim
anyway. Output is unchanged on all 17 shapes checked.

**`ramonda-check-context`** derived the tsconfig's directory with a regex; it now uses
`path.dirname`, which is what the operation is called. Reported by CodeQL. The analyzer's result is
unchanged — same components, same contexts, same issues, verified against an absolute path, a
relative one, and one already ending in a separator.

Separately, two `console` calls built their message by interpolation and passed a value after it.
A console treats its first argument as a **format string**, so a `%s` inside the interpolated part
consumed the argument that followed — and in both cases that argument was the payload:

```
of /about%s failed:  →  "of /aboutupstream down failed:"   (the error never printed)
```

`createIsrCache`'s default `onError` lost the reason a rebake failed; the devtools log row lost the
data you clicked it to see. Both now use a `%s` placeholder. Reported by CodeQL for the first one.
