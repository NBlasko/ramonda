---
"@ramonda/router": patch
---

Test only: a `Portal` open while the route changes

Queue item 7. A portal renders into a target outside the subtree the router swaps — `document.body`
for a modal — so nothing about the DOM connects the two. What takes a modal away when its page
leaves is the component tree: the portal belongs to whoever declared it, and that owner is unmounted
with the route.

So the question is whose modal it is, and both halves are asserted. A page's leaves with the page
and returns on the way back, including through a browser Back; the shell's stays open across every
navigation. Both pages aim at the same target, so a teardown that cleared the TARGET rather than
what the portal owns would take the shell's modal with it.

Also pinned: the leaving page is destroyed before the arriving one is created, which is what makes a
shared target safe — there is never a moment with two page modals in the document.

No behaviour changed.
