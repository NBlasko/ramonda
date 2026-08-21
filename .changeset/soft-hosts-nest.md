---
"@ramonda/check": minor
---

`tag-needs-its-parent` sees through a wrapper to the host element its children land in.

The rule stopped at every COMPONENT, and the reason was right for most of them: what `<Layout>`
renders is decided inside `Layout`, and it may well be the `<table>` this row needs. It was wrong
for the commonest shape there is — a wrapper whose `render()` hands `this.props.children` straight
back, so the HOST element is their parent and nothing of the component's own is in between.
Measured: `<Box><tr /></Box>` with `@Host("div")` is a misplaced row and was reported by nothing.

Three things have to hold, and each is a fact in front of the walk rather than a guess: the tag
resolves to a class this program declares; that class's `render()` hands back `this.props.children`
and nothing else; and its `@Host` names a tag.

**The host tag is read through a NAME as well as written out** — `@Host(TABLE)` where
`const TABLE = "table"` is the same host as `@Host("table")`. A tag CALLBACK is computed from props
and has no single answer, so the walk stops there exactly as it used to, and a component that
renders a `<table>` of its own is untouched: the children land inside that, not inside its host.

No change to what is reported on any project in this repository.
