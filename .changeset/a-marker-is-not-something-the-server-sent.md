---
"@ramonda/core": patch
---

A hydration mismatch no longer points the reader at the framework's own bookkeeping

When a component renders more nodes on the client than the server wrote, the walk runs out of server
nodes inside that component's run — so the cursor is standing on its own closing marker. The DOM was
already handled correctly: a comment is structure, so the fresh node goes in front of it rather than
replacing it. The diagnostic was not. Naming the node by `nodeName` produced

    <Inner /> rendered <b> but the server sent <#comment>.

and the comment is a marker this framework wrote, not anything the server was asked to send. There is
nothing there for a reader to go and look at.

What it says now is what happened: the server's run for that component ended, so it sent **nothing**.
An OPENING marker reads as "a component" — the marker carries an id rather than a class name, so the
name is not ours to give — and any other comment as "a comment". One helper decides it, and all three
places that report a structure mismatch go through it.

Two tests come with it, both covering the direction that had none: a component whose server block is
SHORTER than its client render, and one the server rendered empty and the client fills in.

A text node in the way is named the same way: by what it says, not as `<#text>`.
