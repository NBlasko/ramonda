---
"@ramonda/check": minor
---

`fresh-object-in-props` knows about `@StableProps` now.

An object literal in a component's props is a fresh reference every render — unless the component
that receives it has declared the prop a value, and then the framework compares it by content and
hands the child back the identity it already had. The literal at the call site is the documented way
to write it at that point, so reporting it would be reporting the fix:

    @StableProps("conf")
    class Settled extends Component<{ conf: Conf }> {}

    <Settled conf={{ dense: true }} />     // no longer reported
    <Row conf={{ dense: true }} />         // still reported — Row declares nothing

It is the same move `RMD020` makes at runtime, for the same reason: the two nets have to agree about
what the framework now supports.

The declaration is RESOLVED through the checker rather than matched by name — a class whose name
happens to equal this one's is a different class — and read through the heritage chain, because
`@StableProps` merges along it: a base that declares `conf` settles it for every subclass.

`ElementContext` carries `resolve` for it, which every other context already had.
