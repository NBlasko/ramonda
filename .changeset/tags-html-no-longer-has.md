---
"@ramonda/check": minor
---

New rule: `element-html-removed` — a tag HTML dropped, still rendered by every browser

These are not typos. Each was a real element once, each still parses, and most still paint
something on the screen — which is exactly why they survive in a codebase: nothing breaks, so
nothing draws attention to them. What they no longer have is a specification saying what they MEAN,
so an accessibility tree has nothing to map them to and a future browser owes them nothing.

**Two of them are worse than obsolete.** `<marquee>` and `<blink>` MOVE, and moving content that
cannot be paused fails WCAG 2.2.2 outright: a reader who needs time on a line cannot get it, and for
some people motion is a vestibular trigger. The report says so in a different sentence from the one
it gives the others, because "this fails a success criterion" and "this was tidied out of the
standard" are not the same news.

Each entry carries a REPLACEMENT rather than a correction, which is what separates this from
`attribute-that-does-nothing`: these names were right once, so the answer is what to write now
(`<abbr>` for `<acronym>`, `<s>` or `<del>` for `<strike>`, CSS for `<center>` and `<font>`).

The table leans SHORT like every table this package reports FROM — a name too many is a report
against markup that is fine — so `<isindex>`, `<nextid>` and `<plaintext>` are left out. Nobody is
typing those into a new component, and a table nothing consults is a table that drifts.
