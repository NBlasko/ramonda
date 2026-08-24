---
"@ramonda/check": minor
---

New rule: `autocomplete-that-fills-nothing`

A browser matches `autocomplete` against the HTML specification's list of autofill field names and
against nothing else. A token that is not on it is **not a near miss the browser corrects** — the
whole value is ignored and the field never fills. `autocomplete="fullname"` looks exactly as
deliberate as `autocomplete="name"` and does exactly nothing.

It fails in the quietest way an attribute can: the markup is valid, the attribute is in the DOM,
nothing is logged, and the only symptom is a form that does not fill — which reads as the browser
being unhelpful rather than as a typo in the source.

**Who it is for, because it is not only a convenience.** Filling an address by hand costs a person
with a motor impairment real effort and real errors; somebody using voice control may have no other
way to enter a long string accurately; and anybody on a phone is retyping a card number they have
already given a browser once. It is also WCAG's *Identify Input Purpose*, which asks for exactly
this vocabulary and no other.

`shipping`, `billing`, `home`, `work`, `mobile`, `fax` and `pager` say WHICH address or number and
are not fields on their own. A value that is only one of those gets its own sentence in the report,
because naming a group and no field is the commonest near miss and reads as complete.

**The ordering is deliberately not policed.** The grammar is an optional `section-*`, an optional
group word, an optional contact word, the field name, and an optional trailing `webauthn`. This asks
the part that is unambiguous — is there a field name at all — and says nothing about the order in
front of it, because being wrong about those rules would mean reporting a value that fills perfectly
well. `section-blue billing cc-number` and `username webauthn` are both silent.

Silent on a value it cannot read, on an empty one, on `on`/`off`, on a `<div>` (which no browser
fills), and on a spread that may replace the attribute. Answers for a `@Host` props bag as well as a
tag.
