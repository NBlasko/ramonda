---
"@ramonda/css": patch
---

A type of your own called `CssBlock` is no longer mistaken for one.

The two typed rules asked for the NAME, so a project declaring its own
`type CssBlock = { className: string }` was told its prop was never used — in a file that has never
heard of this package. The extension carries this plugin and an editor opens it on every project
there is, so that is not a corner.

A compiled block is known by its brand now, which is what a `unique symbol` is for: a look-alike
carries none, an import alias carries it, and a generated `css-system` re-exporting the real one
carries it too.

**And the editor now agrees with the build about a file holding no block.** A component may declare
a style prop and hold no block of its own — a wrapper that only hands its prop on. The build
reported it and the plugin returned early, so the editor said nothing where a build would refuse,
which is the one disagreement this package cannot afford.
