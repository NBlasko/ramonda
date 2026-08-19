---
"@ramonda/core": patch
---

Two diagnostics were telling readers the wrong thing, found while auditing which of them could be
answered statically.

**`RMD042` carried `RMD043`'s advice.** Its title is "The default host cannot be the direct target of
this event" and its fix text was, word for word, the paragraph about `Head` matching `<meta>` tags by
`name`, `property` or `http-equiv` — copied, and never noticed, because a fix text is only read by
somebody who already has the problem. It now explains the boxless host: `display: contents` generates
no box, so a bubbling event still arrives from the children while `mouseenter`, `focus` and `scroll`
never arrive at all.

**`RMD041` described a mechanism that does not exist.** It said "the selector matched nothing", and
advised attaching to the host instead — but the three event decorators take no selector. They resolve
to `window`, to `document`, or to the component's own host, so the only way to reach that report is
`@onElement` on a component whose host was not there when the effect ran. The advice now says that,
and says what to look at when it repeats.

Neither was reachable by a test: a fix text is prose nothing asserts. They were found by reading each
diagnostic against what raises it.
