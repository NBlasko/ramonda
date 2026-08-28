---
"@ramonda/check": patch
---

`half-built-keyboard-path` stops reporting a composite widget built across components

The rule already knew the container may own the keyboard: a `listbox` takes the arrow keys while its
options carry a roving `tabIndex={-1}`, and a `toolbar` and a `tablist` do the same. That was fixed
for the case where the container and its children sit in ONE render.

They usually do not. `<Toolbar>` renders the `role="toolbar"` and the `onkeydown` and takes the
buttons as children, which is how anyone actually builds one — and from inside the rule that ancestor
is a capitalised tag with nothing written on it. So the recommended shape was reported, and the
half-fix looked identical to a whole one from in here.

A COMPONENT ancestor now means the same as a key handler on an ancestor: do not report. What it puts
around its children is decided in another file, and guessing is how a rule reports correct code.

The cost is a real report lost when that component ancestor is a plain `<Layout>` handling no keys at
all. That is the trade this package takes every time — a false report against a widget built
correctly costs more than a missed one against a widget built wrongly.

Found by walking the merged rules against the checklist rather than by a test. The rule passed
everything it had.
