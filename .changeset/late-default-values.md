---
"@ramonda/form": minor
---

`defaultValues` may arrive after the form exists

"Fetch the record, then fill the form" did not work at all. `defaultValues` was read once, on the
form's first look at its own values, and never consulted again — so a form handed `{ name: "Ada" }` a
moment after mounting went on showing the empty strings it started with, and nothing reported it.

Move the prop now and the form follows, by the rule anyone asking for this wants:

- a field the user has **not** edited takes the new value
- a field the user **has** edited keeps what was typed

Losing what somebody is halfway through typing because a request came back is the failure worth
designing against; leaving an untouched field empty is the other one. React Hook Form arrives at the
same place as `values` + `keepDirtyValues`.

"Edited" is not "visited": `touched` means blurred, and tabbing through a field without typing in it
leaves nothing of yours to protect. A `reset()` — of the form or of one field — hands everything back,
so a form you have reset is open to the next set of defaults again.

**Array fields merge per row while the length is unchanged**, so one edited row does not hold the rest
back. Once a count differs the array goes whole: yours if you have added, removed or reordered a row,
the new one if you have not. Pairing rows by number across a length change would put one row's text
onto another, which is the failure row identities exist to prevent. Rows that survive keep their ids,
so a caret and a selection stay where they were.

The form then revalidates, because `isValid` must describe the values it now holds, and drops the
messages recorded against the values that were replaced.

**Nothing happens when the defaults did not really move.** The comparison is by value, so the props
callback rebuilding the object every render — which is what a props callback does — writes nothing,
renders nothing, and leaves `values` as the same object. That costs one comparison per render of the
owner: 2 µs at ten fields, 13–20 µs at a hundred, over three runs.

One thing to know when you write the callback: hand `defaultValues` an object you already have — what
the fetch returned, a module constant, a field — rather than building one inline. A rebuilt literal is
reported as RMD022, and that diagnostic's advice is `stable()`, which is the right answer for most
props and the wrong one for this one, for the reason below. Holding the object leaves nothing to
report and nothing to wrap.

It is the form's own comparison and it is unbounded, which is a choice worth naming: declaring
`defaultValues` stable would have the framework hold the identity and skip all of this, and the
framework's comparison stops at five levels and the first fifty items of an array. Past the depth it
answers "different", which is safe; past the width it answers "equal", which is not. Measured with the
declaration in place, a record whose only change was row 55 of 60 was silently dropped. Right for a
cache key, wrong for the values themselves.

Also fixed, found on the same path: **a submit superseded while an async schema was still out left
`isSubmitting` true forever.** The superseded verdict is still dropped — it is about values the form
has moved past — but the button is released. Typing one character during such a submit used to wedge
the form with no way back. A synchronous schema was never affected, which is why it went unseen.
