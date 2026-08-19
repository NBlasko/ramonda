---
"@ramonda/core": minor
---

`<img>`, `<area>` and `<iframe>` now have to be named, in the types.

These are the elements with nothing inside them to work them out from, so the name is the content
rather than a nicety. Any of `alt`, `aria-label`, `aria-labelledby` or `title` satisfies it —
`<iframe>` takes the last three, since `alt` is not one of its attributes.

**A union rather than `alt: string`**, deliberately. `unnamed-image` already accepts all four, and a
type demanding `alt` alone would refuse `<img aria-label="…">` — markup the checker calls correct.
A type and a rule disagreeing about the same line is worse than either being slightly lax. `alt=""`
satisfies it, which is right: it is the documented way to say "decoration, skip me", and that is a
decision somebody made rather than one they forgot.

**What it does to a spread is the point.** `<img {...rest} />` with an untyped bag is refused,
because nothing about that bag says a name is in it — and that is exactly the case the checker
cannot speak about, since a spreading element is handed to no rule at all. The two halves cover each
other instead of overlapping. A spread whose TYPE carries a name passes, which is the shape a
wrapper component should have anyway.

Measured across every app and package here: zero errors, scaffold templates unaffected, and the
documentation's own examples typecheck unchanged. The production bundle is byte-identical — types
are erased.

**A spread is not restricted.** The requirement is about the name, and anything that proves one is
there satisfies it — the spread's own type, or an attribute written beside it:

```tsx
<img {...anything} alt="written out" />   // fine — the name is right there
<img {...imgProps} />                     // fine — the type carries one of the four
<img {...bag} />                          // refused — nothing says a name is in it
```

Controls are untouched: nothing is required on an `<input>`, `<select>` or `<textarea>`, so a form's
`bind` spread goes on exactly as before.

All of it is pinned by `packages/core/src/__tests__/JsxTypeClaims.tsx`, which states every claim in
both directions — shapes that must compile, and shapes under `@ts-expect-error` that must not. A
directive that stops being necessary is itself an error, so relaxing any of this fails the typecheck
rather than passing quietly. Verified by relaxing the image requirement (four directives went
unused) and one refused name (one did).
