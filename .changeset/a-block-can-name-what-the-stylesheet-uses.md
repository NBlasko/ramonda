---
"@ramonda/css": minor
---

Named blocks: `@@keyframes( … )`, `@@font-face( … )`, `@@property( … )`

A style block is one element's rule, so the three at-rules that name something for the whole
stylesheet were reported inside one and had to be written in a separate `.css` file — which left the
name an unchecked string on both sides. `animation: slidein` was one typo away from silence.

They now have a block of their own, with the at-rule in the opening:

```tsx
const slide = @@keyframes(
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
);

const card = @@(
  animation: {{slide}} 240ms ease-out;
);
```

The rule goes to the stylesheet under a hashed name and the site compiles to that name, so the same
animation written twice is one `@keyframes`, and the reference is an ordinary binding — a typo is an
unresolved identifier with TypeScript's own *did you mean*.

**A reference is resolved when the file compiles, not on the element.** It costs no custom property,
and it has to work this way: `var()` takes a literal name, so a reference that stayed a hole would
compile to `var(var(--…))`, which resolves to nothing. Measured in Chromium.

**`@@property` names a custom property**, so it compiles to `--r-…` with the dashes, and it is the
one thing a hole may stand in as a property NAME — which is what lets a generated registered property
be set:

```tsx
const angle = @@property(
  syntax: "<angle>";
  inherits: false;
  initial-value: 0deg;
);

const turn = @@keyframes(
  from { {{angle}}: 0deg; }
  to { {{angle}}: 180deg; }
);
```

Measured: that pair interpolates — exactly 90° at half time, which an unregistered custom property
never reaches, because it flips from frame to frame.

**Each body is checked against its own vocabulary**, generated from the same sweep as the property
map: `@font-face` and `@property` get a descriptor interface each, so a descriptor that does not
exist is a type error with a suggestion, and one that is REQUIRED and missing is a type error too — a
`@font-face` with no `src` loads nothing, and nothing else could have said so. `@property` without
`inherits` is reported because Chromium drops the whole rule without it: measured, the rule is not in
`cssRules` at all and the name accepts any junk afterwards.

Three rules cover what a type cannot see, because they are about shape: a frame that is not `from`,
`to` or a percentage; a declaration outside any frame, which belongs to no time and is dropped; and a
nested rule in a descriptor list, which has no element to select against.

The at-rules are still reported INSIDE an ordinary block, where they compile to
`.r-…{@keyframes slide{…}}` and no browser resolves them.
