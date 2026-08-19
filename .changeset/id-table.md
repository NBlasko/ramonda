---
"@ramonda/check": minor
---

A fifth subject — **the whole project** — and the first two rules over it:
`fragment-link-to-nowhere` and `reference-to-an-id-that-is-not-there`.

An id is written in one component and named in another: `<a href="#pricing">` in a navigation bar,
`id="pricing"` on a heading three files away. No per-render or per-element subject can see both ends
of that pair, which is what makes this a subject of its own rather than another rule family — and it
is the only one that needs **two passes**, because the question is about absence and absence cannot
be established from a file nobody has opened yet.

**`fragment-link-to-nowhere`** — `href="#name"` where nothing carries that id. A fragment link is
answered by the browser rather than a server, so a broken one fails with none of the usual signals:
no 404, no network error, nothing in the console. The page just does not move. The people it costs
most are the least likely to be in the room: a skip link is the first thing a keyboard reader uses,
and the one nobody testing with a mouse ever presses.

**`reference-to-an-id-that-is-not-there`** — `aria-labelledby`, `aria-describedby`, `aria-controls`,
`aria-owns`, `aria-activedescendant`, `aria-details`, `aria-errormessage`, `aria-flowto` and
`htmlFor`. These do not describe an element, they point at one; when the pointer resolves to nothing
the attribute does nothing at all, silently. The report says what each one costs — a broken
`aria-labelledby` leaves a dialog announced as "dialog" and nothing more; a broken `htmlFor` leaves
the input unnamed and stops the label focusing it. `aria-labelledby` takes a **list**, and each id in
it is checked on its own.

Only **negative** existence is claimed at this scope. "Defined twice" is not a fault here — two pages
may each have a `main` and are never in one document together; that stays `duplicate-id`, whose
subject is one render.

Three decisions about silence, and two of them were found by running it rather than by reasoning:

- An `id` this cannot read **on a host element** silences the whole family: an author building ids at
  runtime has said that "defined nowhere" is not knowable here.
- An `id` on a **component** does not, because it may be data. The first version went completely
  quiet against this repository's own documentation site over `<ProfileCard id={this.id} />` — a
  *profile's* id, handed to `getProfile()` and never near the DOM. Nothing is lost by the narrowing:
  a component's `id` reaches the document only through a host element, which is in the source too.
- A **spread** does not silence either, and that is the one accepted residual risk. Counting it was
  measured against this repository and would have switched off every rule in every project in it —
  four to sixteen spreading elements each, against zero unreadable host ids. A spreading element is
  still never asked about its own references.

A template's literal head is used as a proof, not a guess: `` id={`row-${id}`} `` can only produce
ids beginning with `row-`, so `#row-3` is not called missing while `#pricng` is.
