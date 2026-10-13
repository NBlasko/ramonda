---
"@ramonda/css": minor
---

`@container sidebar (…)` asking for a container name no element is given is reported — `container-name-not-set` in `ramonda-css`, and the build stops on it, as it does on a `var()` nothing sets. A name comes from `container-name` or `container` in any block, or from the new `externalContainerNames` config key for a stylesheet this does not compile.
