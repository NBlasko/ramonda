---
"@ramonda/check": minor
---

Two new rules over the project subject: `control-with-no-label` and `named-only-by-a-placeholder`.

Every other element on a page can be worked out from what is inside it. A control cannot: an
`<input>` is an empty box, and the only thing saying whether it wants an email address or a postcode
is its label. Without one a screen reader announces "edit, blank" and stops, voice control has
nothing to say the name of, and the text sitting beside it — which looks like a label to anybody
using a mouse — is attached to nothing. The form looks completely normal, which is why this survives
review.

It belongs to the project subject because one of the four ways to name a control is
`<label htmlFor="email">` paired with `<input id="email">`, and those two are frequently not in the
same render. The other three are local: a wrapping `<label>`, an `aria-label`/`aria-labelledby`, a
`title`.

**Why the second rule exists.** A `placeholder` really does give a control an accessible name, so
calling such a control unnamed is false — and told they have "no label" for a field with a
placeholder in it, somebody reasonably decides the checker is wrong and stops reading its output.
The first version of `control-with-no-label` made exactly that mistake: it reported six controls
across this repository and **every one was placeholder-only**, which the rule's own docstring already
said would not be reported. The docstring was right and the code did not do it.

So `named-only-by-a-placeholder` makes the accurate claim instead: the name exists **only while the
field is empty**. Nobody sees that while writing a form, because a form is written empty — it shows
up for the person interrupted halfway through, the person checking their answers before submitting,
and anybody whose autofill just filled six boxes and cleared six explanations at once. A placeholder
*beside* a real name is a hint, which is its job, and is not reported.

Silences: a control whose own `id` cannot be read (it cannot be matched against any `htmlFor`, so
nothing about **that** control is knowable — a narrower silence than the family's, and
`control-with-no-label` deliberately does not share the project-wide one). `submit`, `reset` and
`button` inputs, named by their value. `hidden`, which is not rendered. `image`, which belongs to
`unnamed-image`.

One residual risk, stated rather than hidden: `<label><SomeField /></label>` names the control
inside `SomeField` at runtime and nothing in that component's source shows it, so such a control is
reported although it works.
