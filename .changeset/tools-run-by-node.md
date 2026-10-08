---
"@ramonda/css": patch
---

**`ramonda-css format` and `lint` run on Windows.** They looked for biome and oxlint in
`node_modules/.bin`, plain name first — on Windows that is a shell script, and the `.cmd` beside it is
one Node refuses to start without a shell. They now run the script each tool's package names as its
bin, with Node, which is the same file on every system. The editor extension does the same for
`ramonda-css` itself.
