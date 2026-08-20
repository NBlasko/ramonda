---
"@ramonda/core": minor
---

**`@compute` and `@memoized` are allowed on `render`**, and a cached render is NOTED rather than warned
about.

The ban existed because `@compute` used to turn `render` into a property and the page died with
`component.render is not a function`. The method form installs a function now, so that is gone — and the
ban was protecting nobody anyway: `@compute get body()` returned from `render` does exactly the same thing
and was always legal. Measured, the wrapper blinds `RMD020` and freezes on a plain field identically. A rule
that costs one wrapper to step around teaches that the rule is arbitrary.

**What replaced it is one `info` line, once per component**, with no diagnostic code:

> `<Board />` has a cached render, so RMD020 cannot compare its output — an inline handler, an object
> rebuilt in place and a value that does not come from state go unreported in the render itself. A
> `list()` row is still checked, because the list builds each row twice on its own. And a cached render
> refreshes only when a SIGNAL it read moves, so anything else it reads keeps its old value. All of it is
> the deal; nothing here is wrong.

A `list()` row keeps its cover, and that is measured: `listEngine` builds each row twice itself, so a
handler built per row is still reported while the render around it is cached.

Not a warning, because caching a render is a deliberate choice and a warning on one of those is how a
codebase learns to scroll past warnings. Not a code, because a code puts it in the list of faults to sweep
for.

**It asks the decorator, not the output.** Identity was the first attempt and it has false positives,
measured: `render() { return this.props.children }` and `render() { return A_CONSTANT }` also hand back one
object and hide nothing the parent did not already check. The cost of asking the decorator is stated rather
than hidden — a `@compute` body returned from `render` is the same deal and is not noted, because at that
point nothing distinguishes it from those two.

The ban stays for every decorator where it still means something: `@created`, `@mounted`, `@updated`,
`@destroyed` change when the render runs, `@catchError` makes it the handler for its own subtree, and
`@state`/`@persist` mean "serialise me", which a render is not.
