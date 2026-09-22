---
"@ramonda/css": patch
---

A typed rule no longer hides a TypeScript error, and no longer speaks about a declaration with no body.

Both were found in one file — a wrapper that takes a block and passes one on, which is an ordinary shape:

```tsx
declare function Inner(p: { css?: CssBlock<{ color?: string }> }): JSX.Element;

export function Card(props: { css?: CssBlock<{ "padding-left"?: string }> }) {
  return <Inner css={@@( ...{props.css}; padding: 8px; )} />;
}
```

**`padding` is two different faults on one character** — the receiving slot does not allow it, and it
clears what this component's own caller may send. The filter that stops a rule and the compiler
saying one thing twice dropped the compiler's, so a real type error vanished behind a rule that had
never mentioned it. The typed rules are left out of that filter: they answer a question TypeScript
cannot ask, so a collision is never a repetition.

**And `Inner`'s prop was reported as never used.** An ambient declaration states a signature and
holds no code, so nothing in it could put a prop on an element — a subject whose scope has no body
is no longer a subject.
