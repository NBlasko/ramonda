---
"@ramonda/core": patch
---

`@StableProps` settles children, and it is now written down that it does.

Measured rather than assumed, in `ChildrenAreProps.test.tsx`: a component given children renders
four times over three renders of its parent, where a childless one renders once. A rendered node is
built during the render, so children are a fresh value every time and the shallow comparison can
never match them — even when the children are a piece of static text. A node handed over as a prop,
`header={<Header />}`, is the same thing wearing a different hat.

Nothing changed in the runtime; `children` was always a prop and `@StableProps` always named props.
What was missing is that anyone would think to write it:

```tsx
@StableProps("children", "header")
export class Panel extends Component<{ header?: unknown; children?: unknown }> {}
```

The tests pin the behaviour, including that it is not a freeze — children that really change still
arrive, and so does content nested deeper than the comparison goes. Also measured: a slot taking the
component CLASS, `view={Header}`, costs nothing to begin with, because a class is the same reference
for the life of the module.
