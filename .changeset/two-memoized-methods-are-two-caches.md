---
"@ramonda/core": patch
---

**`@memoizedHandler` on two methods of one component returned the same handler.** The second method's
call ran the first one's body — no diagnostic, nothing thrown.

The cache is one map per instance, shared by every memoized method on it, and the key was built from the
arguments alone. So `removeFor(1)` and `editFor(1)` collided:

```
removeFor(1) === editFor(1)     // true
remove(); edit();               // "remove:1", "remove:1"
```

That is the commonest shape there is in a list row — several per-item handlers keyed by the same id. The
member's name is part of the key now, separated by a NUL (`\u0000`) because a caller's own string goes
straight into the key and `editFor("remove")` could otherwise land on `removeFor`'s entry. A test pins
that case too.

**How it was found, which is the part worth repeating.** A playground page with three buttons per row —
remove, remove-after-a-class, remove-inside-a-view-transition — where all three did the same thing. Every
existing test used one memoized method per component, so nothing in core's 1174 tests could see it.
