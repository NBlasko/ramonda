---
"@ramonda/check": minor
---

`unserializable-state` and `persist-of-a-lossy-value` say WHERE the value is built.

`@state rows = level1()` reported that the field holds a `Map` and gave the reader nowhere to go.
Both rules now name the place, and the INNERMOST one: `level1` is already on the line being read, so
the report says `level3`. `built in \`makeCache\``, `built in \`SHARED\``, and nothing at all when
the value is written on the line itself.

`unserializable-state` was then walked through the whole checklist, which is what turned this up.
Everything else about it holds: the value a cast, a module `const`, a helper, a chain of three, a
helper handing back one it HOLDS, a ternary or a `??` away is reported; a field a base declares is
reported once, at the base; a hook's state crosses the same blob; and a plain field, a `@compute`
and a JSON-safe value are all silent. The browser-only half of the gate covers the followed values
too — the gate is about the project, not about how the value was spelled.
