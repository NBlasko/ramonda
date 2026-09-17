---
"@ramonda/css": patch
---

The editor plugin no longer reads every declaration file looking for a style block.

The overlay let through anything named like source, which is every `lib.*.d.ts` and every `.d.ts` in
`node_modules`. On a project holding one small file, 174 files reached it — 172 of them declarations
— and 4.9 MB of text was read.

That is work for an answer known in advance: a declaration file declares types and has no
expressions, so there is nowhere in one for `@@( … )` to be written.

The cost was paid per project rather than per editor session, so a monorepo paid it again for every
package a file was opened in. Measured through a real `tsserver`, opening a second project: 248 ms
with the plugin against 59 ms without. It is now 62 ms — the same as a plugin that does nothing at
all, and the same as no plugin.
