---
"@ramonda/core": patch
---

Test only: the inspector's view while the tree moves

Queue item 8, the last of the campaign. The inspector is the one thing here that watches rather than
renders, and it reads the CHILD RECORD rather than walking the DOM — it has to, because a component
owns a range of nodes and may own none. So it can be wrong in a way nothing else notices: the page
stays correct while the panel draws rows in an order they are not in, or a component that unmounted
three renders ago.

Four cases: a slot's contents are drawn where they LAND, a reorder is drawn in the new order, a
dropped row leaves the picture, and a portal's contents are drawn where their NODES are — absent
from the container they were declared in, present as a root beside the app.

The last two rules are opposite and both right: a slot's content really is rendered by the component
it lands in, while a portal's is rendered into a target that belongs to nobody.

Order is asserted along with shape, since two rows both called `Leaf` pass any assertion about names
alone. No behaviour changed.
