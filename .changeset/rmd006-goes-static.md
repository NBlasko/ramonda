---
"@ramonda/check": minor
---

A new rule: `interval-with-no-cleanup`, the static half of `RMD006`.

An interval does not stop by itself, and nothing about unmounting a component touches one. So the
callback keeps running on a schedule — reading state nobody is showing, holding the component and
everything it closed over alive, and doing it once a second for as long as the page is open. Open
and close the same view ten times and there are ten of them.

Three shapes, each certain rather than likely: the id **discarded**, so nothing can ever clear it;
the id kept in a **local**, which dies with the call that made it; and the id on a **property no
`clearInterval` in the class ever names** — the documented shape done half way, which is the one
worth catching, because somebody followed the advice as far as the property and stopped.

**`setTimeout` is deliberately not reported.** A timeout stops on its own, so an uncleared
`setTimeout(fn, 0)` is the commonest correct line of asynchronous code there is. A long one *can*
outlive a component — and telling a long one from a short one is a judgement about a number, which
is exactly the kind of maybe this package refuses. The runtime keeps that half, where it can see
what is still armed.

The global is told from a method the way `browser-url` tells `location`: a bare name that resolves
to **nothing** is the platform's, which costs no type at all — the program is built with no lib, so
a name the browser owns has no declaration and one the app wrote does.

Nothing in this repository trips it, and that is because the shape is not here: every timer in it
goes through `@interval`, which starts on mount and clears itself on unmount. Proved by planting all
three shapes into a real app and watching two of them reported while the cleared one stayed silent.
