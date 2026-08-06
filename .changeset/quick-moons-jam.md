---
"@ramonda/core": patch
---

A component's `ref` now follows the JSX, and fills on a hydrated page

`<Child ref={r} />` pointed `r` at the child's host when the child was CREATED, and never again. A
component that stayed put while its ref changed therefore kept the ref it was born with: the new one
never filled, and the old one went on pointing at a host that no longer claimed it. Measured —
swapping `r1` for `r2` on the same component left `r1.current` on the host and `r2.current` null,
where the identical JSX one line down on a `<p>` swapped correctly, because `Attribute.ts` has
released and re-pointed an element's ref all along.

The same gap on the third route to a host: hydration ADOPTS the server's element rather than building
one, and `adoptHost` did everything `createComponent` does except point the ref at it. On a
server-rendered page a component's ref stayed empty until something re-rendered it — on a static page,
never. An element's ref filled correctly the whole time.

Create, update and adopt now all go through one `applyRefFromProps`, which releases the ref it
replaces (only if it still points at that node, so a ref another element has already claimed in the
same pass is not wiped) and points the new one at the host. Removing a `ref` from the JSX releases it;
adding one later fills it. A ref change schedules no render, because a ref is not a render input.
