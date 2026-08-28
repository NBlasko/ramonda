---
"@ramonda/check": minor
---

New rule: `live-region-that-contradicts-its-role`

`role="alert"` and `role="status"` are live regions with a politeness built in: an alert is
`assertive` and interrupts whatever the reader is being told, a status is `polite` and waits for a
gap. An explicit `aria-live` beside either **replaces** that — and there are only two values it can
take, so writing one is always either redundant or a reversal.

**An alert made polite waits.** A validation error, a failed save, a session about to expire —
announced when the reader happens to pause, which on a form being filled in may be minutes later or
never. The author picked `alert` precisely because the message could not wait, and then made it
wait.

**A status made assertive interrupts.** A live result count cutting across every keystroke, and the
usual outcome is that the reader turns the page's announcements off entirely — which takes the real
messages with them.

Nobody writes `role="alert" aria-live="polite"` meaning both. It arrives when `aria-live` is added
"to be safe" beside a role that already had it, or when a shared component takes a politeness prop
that the alert case forgot to override. Either way the source says two things and the reader hears
one.

**Agreement is untidy and is not reported.** `role="alert" aria-live="assertive"` says one thing
twice; this package reports faults rather than habits. `aria-live="off"` is a stronger claim than a
politeness — it says the region is not live at all — and belongs to whoever wrote it. A politeness
this cannot read, a role that is not a live region, and a spread that may replace either half are
all silent.

`log` and `timer` are covered with `alert` and `status`, for completeness rather than because
anybody has been caught by them.
