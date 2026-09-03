---
title: Accessibility
description: What Ramonda does for you, the thirty-five checks it runs on your markup, and the part of accessibility that no tool can answer.
section: Across the app
order: 116
---

# Accessibility

**Two of every five rules `ramonda-check` runs are about accessibility** — thirty-five of
eighty-six — and it is the part of the framework that is least visible until you run it. This page
says what runs without being asked, what the checker reads, and, at the end, the part none of it
can answer.

## What you get without asking

**An ARIA attribute is written as a string, never as a presence flag.** HTML's own booleans work by
being *there*: `disabled=""` disables a control, and the parser never reads the value — which is why
`disabled="false"` disables it too and is [reported](/reference/diagnostics/rmd029). ARIA is the
opposite: its attributes are enumerated strings, so an `aria-hidden` written with no value is not
`aria-hidden="true"` — the empty one means neither true nor false, and the element stays exactly
where it was.

```tsx
<div aria-hidden={true} />             {/* aria-hidden="true" */}
<button disabled={true}>Save</button>  {/* disabled=""        */}
```

The framework keys this on the NAME rather than on the value being a boolean, so both are right
without you thinking about it.

**A form field's `bind` carries `aria-invalid`.** Spreading it onto a control announces the field's
validity along with its value, so a message a sighted reader sees is a state a screen reader
reports. See [`bind`](/forms/fields#bind-the-attributes-for-the-control).

## What the checker reads

Thirty-five rules, in seven groups. Each has [its own page](/rules) with what it reports and what to
write instead.

**Nothing to announce it by** — the element exists and has no accessible name.

- [`control-with-no-label`](/rules/control-with-no-label),
  [`label-that-names-nothing`](/rules/label-that-names-nothing),
  [`named-only-by-a-placeholder`](/rules/named-only-by-a-placeholder),
  [`unnamed-image`](/rules/unnamed-image), [`unnamed-frame`](/rules/unnamed-frame),
  [`empty-heading-or-link`](/rules/empty-heading-or-link),
  [`region-with-no-name`](/rules/region-with-no-name),
  [`media-with-no-captions`](/rules/media-with-no-captions)

**ARIA written, and doing nothing.** This is the group with the sharpest failure mode: **the browser
keeps whatever you write.** An attribute is a string, so a misspelled name, an invented role and a
value outside the specification all reach the inspector looking perfectly healthy and none of them
does anything.

- [`unknown-aria-attribute`](/rules/unknown-aria-attribute), [`unknown-role`](/rules/unknown-role),
  [`aria-value`](/rules/aria-value), [`aria-with-no-subject`](/rules/aria-with-no-subject),
  [`aria-state-with-no-role`](/rules/aria-state-with-no-role),
  [`aria-state-the-role-does-not-have`](/rules/aria-state-the-role-does-not-have)

**ARIA fighting the element it is on.** A written `role` always wins, so a role can take away what
the tag already supplied.

- [`aria-that-contradicts-the-tag`](/rules/aria-that-contradicts-the-tag),
  [`role-that-fights-the-tag`](/rules/role-that-fights-the-tag),
  [`role-takes-no-name`](/rules/role-takes-no-name),
  [`role-missing-required-aria`](/rules/role-missing-required-aria),
  [`live-region-that-contradicts-its-role`](/rules/live-region-that-contradicts-its-role)

**Hidden from the tree, and still reachable.** The worst of the three: an element a screen reader
cannot see and a keyboard can still land on, so the focus disappears into nothing.

- [`aria-hidden-on-focusable`](/rules/aria-hidden-on-focusable),
  [`aria-hidden-around-something-focusable`](/rules/aria-hidden-around-something-focusable),
  [`presentation-role-on-focusable`](/rules/presentation-role-on-focusable)

**The keyboard.** A click handler works for a pointer and for nothing else.

- [`click-with-no-keyboard-path`](/rules/click-with-no-keyboard-path),
  [`half-built-keyboard-path`](/rules/half-built-keyboard-path),
  [`interactive-inside-interactive`](/rules/interactive-inside-interactive),
  [`positive-tabindex`](/rules/positive-tabindex), [`access-key`](/rules/access-key)

**The shape of the page**, which is how somebody who cannot see it navigates.

- [`heading-skips-a-level`](/rules/heading-skips-a-level),
  [`more-than-one-main`](/rules/more-than-one-main),
  [`landmarks-that-cannot-be-told-apart`](/rules/landmarks-that-cannot-be-told-apart),
  [`table-with-no-headers`](/rules/table-with-no-headers),
  [`option-that-cannot-choose`](/rules/option-that-cannot-choose),
  [`autocomplete-that-fills-nothing`](/rules/autocomplete-that-fills-nothing)

**Ids, because ARIA is built on them.** `aria-labelledby` is a reference, and a reference to nothing
announces nothing.

- [`duplicate-id`](/rules/duplicate-id),
  [`reference-to-an-id-that-is-not-there`](/rules/reference-to-an-id-that-is-not-there)

## Not one of them fails your build

`ramonda-check` has **nine error rules**, and all nine are about fighting the framework: writing a
prop you were given, an `async render()`, two of a decorator that may appear once. Every
accessibility rule is a **warning** — it prints and lets the run through.

That is a deliberate position rather than an oversight, and the README's argument is the reason: a
gate that fails a build on something nobody has seen yet gets switched off, and a switched-off gate
reports nothing at all. Each of these rules says in its own advice that it is a warning today and an
error in a later version.

**If you want them to fail now**, that is your build's decision to make rather than the framework's
— the run's exit code is what you already have, and you can treat any output as a failure.

## What it cannot see

This is the half worth reading twice, because a green run is easy to mistake for an answer.

**An element that spreads props is left alone entirely.** `<img {...rest} />` may carry the very
attribute a rule is looking for, and nothing here can know. Silence on a spread is not approval.

**A value it cannot resolve is not judged.** `<div role={kind}>` is a role the checker cannot read,
so the rules about roles say nothing about it. The same is true of an `id` built at runtime, an
`aria-label` from a translation call, a `tabIndex` from a prop.

**And the part no tool answers at all.** Every rule here is about markup that is provably wrong —
a name that is absent, a role that contradicts its tag, a reference to an id nothing declares. None
of them can tell you whether the announcement makes sense, whether the reading order matches what
the page means, or whether somebody can actually complete what they came to do. That needs a
keyboard, a screen reader, and somebody using them.

The checker's job is to take the mechanical mistakes off the table so the time goes to that.

## Next

- [Rules](/rules) — all eighty-six, including the thirty-five above.
- [Checking your app](/reference/check) — how to run it, and what it proves that a running page
  cannot.
- [`bind`](/forms/fields#bind-the-attributes-for-the-control) — the one place the framework fills in
  an ARIA attribute for you.
