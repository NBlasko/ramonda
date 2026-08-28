---
"@ramonda/check": minor
---

New rule: `role-that-fights-the-tag`

`<a href="/pricing" role="button">` and `<button role="link">` are opposite halves of one mistake:
the element **keeps its behaviour** and changes only what is announced about it. So the reader is
told what to expect and the element does something else.

**A link announced as a button** loses Space. A button activates on Space as well as Enter, and a
reader who has been told "button" will press it — on a link that is the browser's scroll shortcut,
so the page jumps down and nothing else happens. It also leaves the list of LINKS a screen reader
offers, which is how somebody surveys what a page connects to.

**A button announced as a link** gains an expectation of a destination: a URL in the status bar, a
middle click that opens a tab, "copy link address" in the context menu. None of those exist, and
none of them fail loudly — the menu item is simply absent or copies nothing.

Both are invisible to anybody using a mouse, and both survive review because the page behaves
exactly as intended for the person testing it.

The answer is never the role. The element carries the behaviour and the role only describes it, so
writing one that disagrees cannot bring the behaviour with it.

**An anchor with no real destination is not this**, and that boundary is the rule's own: `<a
role="button">` and `<a href="#" role="button">` are somebody building a button out of an anchor —
`link-without-a-destination`'s conversation, not this one. An `href` this cannot READ goes quiet
with them, and that was a correction: the first draft reported it, on the argument that writing
`href={where}` means the author has a destination. Planted, it does not hold — `where` may perfectly
well be `"#"` — and the silence contract wins, as it does everywhere else here.
