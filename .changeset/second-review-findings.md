---
"@ramonda/check": minor
---

Seven more faults from a second review, each reproduced before it was fixed.

**A helper written as a concise arrow lost every edge in it.** `const header = () => <Legend />`
stores the element as the arrow's body, and the walk iterated the body's CHILDREN — the tag name and
the attributes, never the element. The helper came out with no edges and no hole either, so a
consumer reached that way was never judged. It was in this package's own fixture the whole time.

**A context had two identities, and a package's requirement could never be met.** A local context was
keyed by absolute file and line while a spliced fragment keys it by its graph id, so a fragment
consuming a context declared in another package could not be satisfied by the app mounting that
provider — a false positive against correct code — and an optional context consumed across a
boundary was reported as a hard failure. There is one identity now, the graph's.

**A package's helpers were dropped on splice.** `splice` built nodes for components, hooks and
contexts only and matched no branch for a `calls` edge, so composition that runs through a
package's own `function row() { return <Cell /> }` was invisible. The report now reads
`App → Bare → DataGrid → helpedRow → HelperBody`, naming a function the app cannot import.

**An edge could name a node the graph does not declare.** A fragment is pruned to its own package, so
its edges may point outward; copying one into an app with no fragment for the other package left a
`to` matching nothing. Those become holes with the reason, and every fixture is now checked for
dangling references.

**A component that mounts itself with another binding was cut as a cycle.** The guard keyed on the
node alone while the bindings travel per path, so a tree renderer's second arrangement was never
walked. It keys on the node and its bindings now, with a hard path limit as the backstop.

**The emitted bytes depended on the machine's locale**, because `localeCompare` ordered the nodes,
the edges and the source hash. Ordered by code unit now.

Also: a dead ternary whose two arms were both `undefined`; the author's name re-encoded as an escape
in four package.json files by a JSON writer; and two changesets that said `patch` where the rule
while everything is 0.x is minor.
