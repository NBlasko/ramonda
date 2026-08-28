---
"@ramonda/core": minor
"@ramonda/check": minor
---

`selected` on an `<option>` is refused, and reported where a type cannot reach

The choice belongs to the select, not to the option. `Select` applies it by walking EVERY option and
setting each one from its `value` — on and off, for all of them — so an option that asked to be
chosen is turned off again a moment later. The attribute is not competing with `value` and losing
sometimes; it does nothing, while being the one line on the page that looks like it chooses.

**`@ramonda/core` refuses it in the types**, the same way it refuses the `<select>` tag itself: the
error arrives at the call site, in the editor, with the answer in it —
*"the choice belongs to the select — write `<Select value={x}>`, which sets this on every option"*.

**`@ramonda/check` reports it too**, as `option-that-cannot-choose`, because a type is a defence
only while nobody casts it away: a `@ts-ignore`, a props bag widened somewhere, a JavaScript file.
That is the same pairing core and check already keep for RMD029 and RMD039.

The rule is narrow on purpose. `selected={false}` says the opposite and is not overwritten into
anything it was not already; `{options.map(…)}` is children it cannot read; a spread may carry the
attribute or replace it; and an `<option>` with no `<Select>` above it is nobody's report, because
nothing is deciding for it.

This is the fault the refused `<select>` tag could not reach. The tag is refused because HTML keeps
the LAST of competing `selected` claims and gives an unclaimed select its first option — so the same
markup meant different things depending on the order the options arrived in, which is not an order
anybody writes.
