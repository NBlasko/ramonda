---
"@ramonda/devtools": minor
---

The controls stay on screen, and the tree keeps your place.

**The toolbar, search and breadcrumb are one sticky header.** They are how you find a component, and
they used to scroll away with the tree — so the moment you found something and scrolled to read it,
the search you found it with was gone.

**A structural re-render no longer moves anything.** One component mounting anywhere in the app
replaces the tree's markup, and `innerHTML` resets its container's scroll to the top — so reading a
component while the app did anything at all threw you back to the root. The scroll position is put
back now, and a branch you folded stays folded: the fold state is read off the DOM about to be
replaced, rather than from `toggle` events, which are dispatched as queued tasks and would be missed
by a rebuild landing in the same task as the click.

Also: `@ramonda/core`'s `NOT_READ` marker moved inside its `__DEV__` block. It was stripped either
way — measured both ways with the production-build test — but at module scope its removal depended on
the bundler noticing that its only reader had been eliminated. Nothing that only development needs
should have to be dead-code-eliminated when it can simply not exist, and the prod build test now
asserts the string's absence.
