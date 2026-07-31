---
"@ramonda/devtools": patch
---

The panel says what a write did, and when the app undid it.

Reported: editing a query hook's `version` and `snapshot` appeared to do nothing. It did not — both
writes landed, verified by driving the real bundle. But `version` is an invalidation counter and
`snapshot` is the hydration transport, so what the page renders comes from the cache either way, and the
hook sets both again on its next cache event. "It worked and the app owns that field" and "it did not
work" looked identical, because the panel closed the box and said nothing.

Now it says `wrote version = 99`, or `count is already that value` — and it watches the field for one
refresh: if the app has put something else there, it says
`version was written, and the app has since set it to 3`. Which is the answer to the question that
prompted this, delivered where the question is asked.
