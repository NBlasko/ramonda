---
"@ramonda/core": patch
---

An element the diff builds is written, not read back

A new element has no attributes and no children until the diff writes them, but it went through the
update path all the same: its attributes and `childNodes` were read back, and its children went in
through the reorder pass one at a time. Now its attributes are only written, and children that are
elements or text are built and appended in order; a list or a component among them keeps the path
that knows it. Measured on js-framework-benchmark's create, it read 28 empty properties per row.
