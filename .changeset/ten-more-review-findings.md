---
"@ramonda/check": minor
---

The rest of the second review's findings.

**A lazily loaded component inside an installed package now resolves.** `classExported` looked the
class up among this project's own components only, so `<AsyncLoad lazy={…}>` pointing into a package
compiled from `dist` found nothing and the whole chunk went unjudged. It reads the package's
fragment now.

**Two exported classes with one name are refused rather than merged.** A package's surface is keyed
by the name an app imports, which is the only handle it has; a second class under that name used to
overwrite the first silently — the name-keyed merge this work removed everywhere else. Neither is
spliced now, and the run says so.

**A route table nobody hands to a `<RouteOutlet>` this run can see is named.** The table is skipped
by the JSX walk because `collectRouteTable` reads it, and that only becomes edges when some outlet
names the binding — so one handed to an outlet outside the program left every view with no edge and
nothing saying so.

**Every `<RouteOutlet>` site is its own node.** Views hung off the shared `RouteOutlet` class, so two
outlets in one app put every view on one node and made each reachable from the other. Each site
`uses` the outlet class, so the matched params it publishes still reach the views — which is why
they were attributed to the outlet in the first place.

**A fragment carries `opaque`.** A component whose own package refused to judge below it was walked
by an app as if it were transparent, so a consumer under it could be reported when the hook the
package could not follow may well have been providing.

**A class extending a CALL is named instead of dropped.** `class Panel extends withTheme(Component)`
needs a type to follow, so it is not a component here — and dropping it in silence made the omission
invisible.

**`slotsOf` keeps its `seen` set per path**, so `{ left: Panel; right: Panel }` yields `right.cell`
as well as `left.cell`.

**A malformed fragment is refused with a reason** rather than throwing out of the splice, and the
hook fixpoint says so when ten passes are not enough instead of quietly under-propagating.

One finding was tried and reverted, with the measurement kept: running the three non-composition
checks over test files again — which is what `main` did — fails `@ramonda/core`'s own build on
`class Bad { fn = () => … }`, a fixture written to be bad because it is what its test is about. A
gate that fails on those is one people switch off. The cost of leaving it is written down where the
exclusion is.
