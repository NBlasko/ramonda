---
"@ramonda/css": minor
---

A prop can now say which declarations may be sent to it.

`CssBlock` takes the allow-list as a type parameter, so a component can narrow what a caller may
write into the block it accepts:

```tsx
type CardStyle = {
  color?: Token<"color">;
  gap?: "8px" | "16px";
  "&:hover"?: [{ color?: Token<"color"> }];
};

function Card(props: { css?: CssBlock<CardStyle> }) {
  return <div className={@@( display: flex; ...{props.css}; )} />;
}
```

The allow-list is an ordinary block shape used as a type, so it is written in the spelling a block
is already written in — the CSS names, and `Token<"color">` where only a declared variable will do.
Nothing new has to be learnt and there is no second dialect beside `ramonda.css.ts`.

What matters is where the fault lands, and it lands where the author can act on it: on the value,
on the property name, or inside the state — never on the call. A caller writing `padding: 4px` into
the slot above is told that `padding` is not in `{ color?: …; gap?: …; "&:hover"?: … }`.

Two things fall out and need no rule of their own. A combinator — `& > span` — is refused because
it is not a key in the allow-list, so a component's internal structure stays out of its API. And
`!important` stops being writable the moment a value is narrowed to a literal union.

A block in no slot is unchanged: the parameter defaults to every shape there is, so every existing
`CssBlock` annotation keeps working and an ordinary block still takes every property there is.

**This raises the `typescript` peer floor to 5.4**, for `NoInfer`. Fixing the allow-list before the
block is read is what puts the fault on the property instead of on the call; inferring it from the
block reported every declaration including the correct ones.
