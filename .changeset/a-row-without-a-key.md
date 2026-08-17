---
"@ramonda/check": minor
---

Two rules the framework already reports at runtime, now provable before anything runs.

`row-without-a-key` — a row built from data with no `key`, from a `map` or from `list()`. From a
`map` there is no identity at all: rows are matched by position, so inserting anywhere but the end
hands every row below it the previous row's state and DOM. From a `list()` the framework infers an
identity from what makes a row different from its siblings, and a key you write wins over it — so a
key is the difference between an identity you chose and one that was inferred, and inference can
fail (a row whose every field is nested or shared with its siblings has nothing to be told apart
by). It matters most in the commonest case: data that arrives fresh, where every object is new and
there is no reference left to recognise.

Only the element a row-building callback RETURNS is asked for a key — in
`rows.map((row) => <tr><td /></tr>)` the `<tr>` is the row and the `<td>` is not. A component row is
asked too, unlike every other element rule, because the component is what holds the state that goes
to the wrong row.

`class-instead-of-classname` — `class` where Ramonda reads `className`, so the styling it names
never applies. It fails invisibly: the element renders, the class string is in the DOM, and the hunt
starts in the stylesheet, which is the one place the fault is not. Host elements only; on a
component `class` is a prop that component declared.

Both are warnings. `class-instead-of-classname` is quiet across this repository;
`row-without-a-key` reports 17 places, every one of them a `list()` relying on inferred identity.
