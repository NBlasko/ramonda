---
"@ramonda/query": minor
---

The focus trigger watches `document.visibilityState` instead of the window's `focus` event.
`refetchOnWindowFocus` keeps its name.

`focus` was wrong in both directions:

- **It missed.** On a phone, leaving the browser and coming back reliably fires
  `visibilitychange`, while `focus` and `blur` are unreliable — so the reader returned to stale
  data and nothing refreshed it.
- **It over-fired.** A page visible the whole time — a second monitor, a split screen, or
  DevTools holding focus — fires `focus` when you click into it, though nothing was ever hidden.
  With the default `staleTime: 0` that was a request per click into the window.

`document.visibilityState` answers what the option is actually asking: is somebody looking at
this again. TanStack reached the same conclusion and dropped its focus listener.

**The behaviour change, stated plainly:** clicking into an already-visible window no longer
refetches. There is a test asserting exactly that, so nobody has to wonder later whether it was
intentional.

The option keeps the name `refetchOnWindowFocus` because that is the name people arrive with,
and it still describes the intent even where it no longer describes the mechanism. Renaming
would cost every reader a lookup to learn that nothing about their app changed.

`@onDocument("visibilitychange")`, since the event fires on the document — and like `@onWindow`
it is built on an effect, so it attaches on the client only and is removed on destroy.
