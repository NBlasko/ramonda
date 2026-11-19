---
"@ramonda/core": patch
---

A component instance holds less, and a list row that runs again writes no subscription it already has.
All lists a runtime keeps (`@mounted`, `@effect`, `@updated` and the rest) share one frozen empty list
until something is added; every field of a component's runtime is there from construction; every props
proxy shares one handler; an element's own children are walked by sibling, so no `NodeList` is left
cached on it; and a component reads its parent's context object until it provides something, making one
of its own only then. A list row whose callback reads the signals it read last time — every row of a
list on a select — stays subscribed to them instead of detaching and attaching each one again.

The work a commit leaves for after the DOM is in is lighter too. A component with no effects queues
nothing to run them. The queue is walked with a cursor instead of `shift()`: when every component still
queued an entry, creating 10,000 rows of five components queued 50,000, and the same build measured
about 800 ms or about 3,900 ms of script from run to run, depending on whether V8 could trim the array
from the front. And the bound that stops a flush whose work keeps queueing more counts only what that
work queues, so a commit with more than 100,000 entries of its own is no longer stopped as a loop.

Measured in Chrome after creating 1,000 rows of five components: about 44 heap objects per component
before, about 26 after. Nothing a component or a list does changes, nor the order anything runs in.
