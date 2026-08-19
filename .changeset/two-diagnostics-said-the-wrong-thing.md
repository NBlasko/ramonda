---
"@ramonda/core": patch
---

Two diagnostics were telling readers the wrong thing, found while auditing which of them could be
answered statically.

**`RMD042` reported working code, and carried `RMD043`'s advice while doing it.**

It fired for every `@onElement` on a default host. Most of those work: measured — a click on a child
of a boxless host reaches the listener, because bubbling needs an ancestor rather than a box. It now
fires only for an event that does not bubble, which is one dispatched at its target and nowhere
else: `mouseenter` needs a box to enter, `focus` needs something focusable.

And the advice was wrong twice over. Its fix text was, word for word, the paragraph about `Head` matching `<meta>` tags by `name`,
`property` or `http-equiv` — copied from `RMD043`, and never noticed, because a fix text is only read
by somebody who already has the problem. It now explains the boxless host, and says why a bubbling
event is not this fault.

**`RMD041` described a mechanism that does not exist.** It said "the selector matched nothing", and
advised attaching to the host instead — but the three event decorators take no selector. They resolve
to `window`, to `document`, or to the component's own host, so the only way to reach that report is
`@onElement` on a component whose host was not there when the effect ran. The advice now says that,
and says what to look at when it repeats.

Neither was reachable by a test: a fix text is prose nothing asserts. They were found by reading each
diagnostic against what raises it.
