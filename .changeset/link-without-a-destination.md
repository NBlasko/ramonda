---
"@ramonda/check": minor
---

A new rule: `link-without-a-destination`.

The tag is not what makes a link — `href` is. Without a real one an `<a>` is not focusable, is not
in the tab order, is not announced as a link, and does not answer the middle click, the context menu
or the "open in new tab" that people use links with. It renders looking exactly like one, which is
why it survives review: the page looks right, and only half the people using it can follow the link.

Three spellings are reported, and the report says what each one actually costs rather than repeating
one sentence: **no `href` at all** (usually an `onClick` where the destination should be),
**`href="#"`** (a destination that is this page — that one IS focusable, so the fault is that every
way of following it but a plain click goes nowhere), and **`href="javascript:…"`** (not a
destination either, and the shape a Content Security Policy refuses first).

Left alone: `href="#pricing"`, which is a real destination and the point of a table of contents; an
`href` written as an expression this cannot read; and an `<a>` carrying an `id` or `name` and no
`href`, which is the legacy anchor **target** — markup doing the opposite of this fault.
