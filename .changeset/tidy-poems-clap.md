---
"@ramonda/core": patch
---

An inline `ref` on a component no longer re-renders it on every parent render

A component's `ref` is the framework's, not the app's data: `<Child ref={r} />` points `r` at the
child's host element when the child is created, and it is never read again. Its identity therefore
says nothing about whether the child should re-render — but it sat in the props bag and was compared
like any other prop, so `ref={createRef()}` written inline handed the child a new object every parent
render, which read as "the props changed". Measured: one wasted child render per parent render,
forever, with no diagnostic.

The comparison now ignores `ref`; everything else about it is unchanged, because it has to be —
`generateRenderOutput` reads `props.key` to put the key on the host element, and a component's `ref`
has to survive to creation. `key` is deliberately still compared: `areSimilarNodes` refuses a node
whose key differs, so a component that reaches the update path always has an equal key and ignoring
it would remove nothing.

The devtools inspector also stops listing `ref` among a component's props, where it showed as an
opaque `{ current: … }` next to the component's actual data.
