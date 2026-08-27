---
"@ramonda/core": minor
---

`<Select>`, because a select's state is its children

A `<select>` is the one element whose own state is not a property of itself: it is which child is
chosen. `<Select value={x}>` says that once, on the element that owns the choice, and settles it
when the options are in the element — told to the select on the client, written onto the chosen
option on the server, which serializes markup and cannot carry a property. So the right option is
showing before any script runs. `<Select multiple value={["a", "b"]}>` takes a list.

It passes everything else straight through: `className`, `disabled`, `name`, every event, every
`data-` and `aria-`.

**`<select>` is now a type error**, and the message TypeScript prints is the instruction. `selected`
on an option is a claim rather than a fact: HTML keeps the later of two and gives a select holding
none the first option it is handed, so what the markup means depends on the order the options
reached the select — an order no author writes and none can see. Measured, with `b` asked for out of
`a b c`: the page showed `c`.

`<option>` is untouched. It has no choice to make, so it stays an ordinary tag, in a `<datalist>` as
much as in a select.
