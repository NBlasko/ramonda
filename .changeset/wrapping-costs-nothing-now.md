---
"@ramonda/core": patch
---

Three places still argued that a wrapper costs an element. It has not for a while.

When a component became a range of nodes rather than one element, wrapping stopped adding anything
to the page — a component renders exactly what its `render()` returns, so one handing back
`this.props.children` contributes no node of its own. The documentation did not follow.

`composition/inheritance.md` answered *"what do I wrap these in?"* with **"None — nothing wraps
anything"**, which was the old constraint's selling point and is no longer a distinction. It now
says both are available, neither adds an element, and the choice is about what you are REUSING:
extend when you are building on a component's own markup and behaviour, because `super.render()` is
what a wrapper cannot do; wrap when you are adding something around children you do not own,
because a wrapper takes anything and a subclass is tied to one parent.

`why/classes.md` said reuse "does not mean nesting, and nesting costs nothing" — which argues
against nesting and then says it is free, in one sentence.

And a test in core still said Ramonda's units of reuse are "the class and the Hook, neither of
which nests". A class nests perfectly well now; what it does not do is leave an element behind.
That test's subject — composition inside a `<tr>`, where only `<td>` is legal — is where the claim
is settled rather than asserted, so it is worth stating correctly.

Comments and documentation only.
