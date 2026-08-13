---
"@ramonda/check": minor
"@ramonda/testing-library": minor
---

A component this cannot follow is an error.

The walk goes quiet below a name it cannot resolve, so everything under it is unjudged and the build
passes over a page that may be broken. That is the one thing this package cannot afford, because its
whole value is that a report is a real broken path rather than a maybe — and that only holds while
the map has no unmarked blanks.

The constraint is not this tool's to impose. A bundler can only split what it can see statically, so
whatever this cannot resolve could not have been code-split either: the shape was already trouble
for another reason.

**The escape hatch is a record.** When the source is right and this is the one that cannot see it,
write the reason on the line:

```tsx
// ramonda-check-ignore the caller hands us the tree to mount, which is what this helper is for
bootstrap(wrap(ui), container);
```

Line-scoped, never file-scoped — a file-scoped suppression blinds a whole file with one line, which
is exactly what somebody in a hurry reaches for. The reason is mandatory: a directive with nothing
after it is refused. And every annotated site is listed on every run, whether or not anything
failed, so the number cannot creep up unread.

A tag naming a prop is not one of these. `<this.props.view />` is unresolvable from the class alone
by design, and the walk fills it from what the caller binds.

Messages carry the fix as CODE rather than as advice, because most of what this reports on will be
written by an agent, and an agent acts on a patch far more reliably than on a sentence.

**Measured across this repository: three sites need the hatch**, all in `@ramonda/testing-library`
and all the same shape — a helper that mounts whatever the caller hands it, which is its whole job.
Those three carry their reason now. The two in `apps/playground-core` are demonstrations of a failed
load, which is what they are for.
