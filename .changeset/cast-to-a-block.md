---
"@ramonda/css": minor
---

**A value cast to a style block is reported: `cast-to-a-block`.** A prop typed `CssBlock<…>` refuses
a plain object, a string of classes and a block its allow-list does not take — a cast was the one
way past, and then nothing checked what the prop held. Measured through the merge: an object cast to
a block throws from inside the render, a style string becomes classes named `color:` and `red;`, and
a refused block lands without a word. The editor and `ramonda-css check` report it, told by the
block type's brand, so an alias, a type alias and a cast to a list of blocks are caught, and a
project's own type named `CssBlock` is not. Minor, because code that compiled before can now be reported.
