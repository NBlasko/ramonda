---
"@ramonda/check": minor
---

A ring of mounts that nothing on it can skip is reported.

A cycle by itself is not a fault, and this is the measurement that decided the rule: the one cycle in
this repository is a markdown renderer and a code block calling each other, and it is correct. A tree
renders itself for each child and stops when the data runs out — that is how a recursive structure is
drawn, and reporting it would report the ordinary case.

What cannot be right is a ring where every step runs on **every** render: no branch, no callback, no
loop anywhere on it. Nothing can stop, so the first render recurses until the stack gives out, before
a page appears, in every build.

That is decidable, so the rule is. Every edge now carries `always` when its site was proven to run on
every render of the body it is written in, and the flag is absent when nothing proved it — a site
this could not read can never invent a fault. `always` is a fact other rules can use: it is the
difference between *may reach* and *will reach*, which the provider walk does not need and this one
does.

Silent across the four apps and five packages here.
