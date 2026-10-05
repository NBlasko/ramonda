---
"@ramonda/css": patch
---

**The build refuses a `@@property` with no `syntax` or no `inherits`** (`property-descriptor-missing`).
CSS requires both, and the browser drops a registration missing either, in silence. The editor
already said so through the type; the build, which does not run the type check, compiled it.
