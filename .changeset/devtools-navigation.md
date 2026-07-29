---
"@ramonda/devtools": minor
---

Navigating the component tree: focus one component, and filter by name.

**A focus button on every row** makes that component the root of the panel, under a **breadcrumb**
of its ancestry (`all components › <App /> › <ProductsPage /> › <ProductDetail />`). Every crumb
is itself a focus target, so the view widens one step at a time, and Escape releases it. That is
the flow the panel was missing: finding a component was possible, but *staying* on it while its
state, props and hooks change was not — the tree moved under you.

**A name filter** in the toolbar hides every branch with no match in it, keeping the ancestors of
a match so the result still reads as a tree. It is applied as a class rather than by re-rendering,
so typing does not reset what you have open or where you have scrolled, and it survives a
structural re-render because it is re-applied from the query rather than read back off the DOM.

The pinned view renders with the paths the nodes have in the whole tree, and the structural
signature is still read from the whole tree — otherwise the panel would rebuild itself four times
a second while focused. There is a test for exactly that, and this package has tests now: 15 of
them, covering the navigation, the filter, and the two Query-tab bugs that shipped in 0.1.0.
