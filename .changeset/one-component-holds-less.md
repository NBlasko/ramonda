---
"@ramonda/core": patch
---

A component instance holds less, and a list row that runs again writes no subscription it already has.
All lists a runtime keeps (`@mounted`, `@effect`, `@updated` and the rest) share one frozen empty list
until something is added; every field of a component's runtime is there from construction; every props
proxy shares one handler; and an element's own children are walked by sibling, so no `NodeList` is
left cached on it. A list row whose callback reads the signals it read last time — every row of a
list on a select — stays subscribed to them instead of detaching and attaching each one again.
And the queue of `@mounted` and first effects a commit leaves behind is walked with a cursor instead of
`shift()`: creating 10,000 rows of five components queues 50,000 entries, and the same build measured
about 800 ms or about 3,900 ms of script from run to run, depending on whether V8 could trim the array
from the front. Measured in Chrome after creating 1,000 rows of five components: about 44 heap objects
per component before, about 29 after. Nothing a component or a list does changes, nor the order
anything runs in.
