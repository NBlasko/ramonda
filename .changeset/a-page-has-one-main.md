---
"@ramonda/check": minor
---

New rule: `more-than-one-main`

HTML allows one `main` element that is not hidden, and it is the only landmark with that constraint.
It has it because `main` is a **destination** rather than a description: "skip to main content" is
the first thing a keyboard reader presses on a page, and a screen reader's landmark list is how
somebody moves around one without scrolling through it.

With two, that destination is ambiguous and tools resolve it differently — some jump to the first,
some list both under the same name — and whichever the reader picks, half the page is now somewhere
they have to find by hand. It looks completely correct to anybody using a mouse.

`<div role="main">` counts, because the accessibility tree does not care which spelling was used.
That is the shape it is most often written in: a layout component owning a `<main>` and a page
component adding a `role` to its own wrapper, neither author seeing the other's.

**One RENDER, not one project.** Two route views may each own a `main` and are never on the page
together; reporting that would be reporting the ordinary way a routed application is written. The
bound is `duplicate-id`'s, and `ProjectRule`'s own note names this exact case as the reason the
project subject may claim only negative existence.

Only the SECOND is reported — the first is the one a reader almost certainly meant, and the report
names its line so the two can be compared without hunting.

Silent on one landmark per arm of a ternary (that is one on the page, which is what `alwaysPresent`
is computed for), on `hidden` — the specification's own escape — on an element that spreads, since
the spread may be carrying that `hidden`, and on a `role` it cannot read. `hidden={false}` is the
source saying out loud that the element is shown, and excuses nothing.
