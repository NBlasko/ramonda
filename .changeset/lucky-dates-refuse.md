---
"@ramonda/form": minor
---

Four defects, each one measured before and after

**A validation that rejects no longer wedges the form.** Standard Schema says `validate` answers with
a result or a promise of one; it does not say the promise resolves, and an async rule doing real
work — a uniqueness lookup against a server — rejects the moment the network does. Nothing gave that
promise a rejection handler, so it surfaced as an unhandled rejection, and `isSubmitting` was never
released: one failed lookup disabled the submit button for the life of the page. It is now reported
as **`RMF004`**, the messages already held are kept, `isValid` goes false — "we asked and did not
hear back" is not "nothing failed" — and the button comes back.

**A date field no longer loses a day.** `bind` formatted with `toISOString()`, which is UTC: 01:00
on the 7th in Belgrade showed as the 6th, and picking that same shown day wrote the 6th back, so the
reader's date moved by being looked at. Both directions are local now, and the time a value already
held is carried across a change of day — a date input cannot express one, so throwing it away moved
an appointment to midnight. Asserted at two times of day, which is what catches the fault on both
sides of Greenwich; verified in UTC, +5:30, +14 and −11.

**An emptied number input is still a number input.** `fromControl` writes `""` for a cleared number
field on purpose, so a schema can report on it instead of `NaN` poisoning arithmetic — but `bind`
read the control's kind off the value's runtime type, so `type: "number"` vanished with the first
backspace, the element reverted to text, and every later read wrote a string. The field never became
numeric again: the spinner gone, and on a phone the numeric keyboard gone mid-entry. A present value
decides the control and is remembered; an absent one keeps what the field was. The same fix covers a
cleared date.

**`reset(record)` no longer reports a dirty form.** `reset` moves the baseline to the values it is
handed — "nothing in a form that was just reset is the user's" — but `dirty` compared against
`defaultValues`, so the most ordinary flow there is, fetch the record then `form.reset(record)`,
marked every field as edited: the unsaved-changes guard fired on the way out and Save came up
enabled. One baseline now answers every "has the user changed this".

And a `Date` is compared by the moment it names. A defaults factory writing `when: new Date(iso)`
builds a fresh object per run, which used to replace the field, drop the messages under it and
re-run the whole schema on every render of the owner, for a value that had not moved.
