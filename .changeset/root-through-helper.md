---
"@ramonda/check": minor
---

A root whose argument calls a helper — `bootstrap(shell())`, `bootstrap(wrap(ui))` — gets the `calls`
edge a component calling that helper gets, so what the helper mounts is reached and judged. It was an
unresolved root, and `@ramonda/testing-library`'s `render` carried two ignores for a design that is
right. Nothing is followed: a helper is a node, and a parameter it mounts stays the caller's. A
component declared inside an exported function is entered through that export, as an exported one is,
so `renderHook`'s host is not reported as unreachable now that the package has a root.

"App or library" is asked of this project's OWN roots now, in every place that asks it: a dependency
compiled from source may have a root, and it made the router an app — its published components
reported as unreachable, and its graph refused as a fragment.
