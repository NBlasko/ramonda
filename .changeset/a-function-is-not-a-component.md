---
"@ramonda/check": minor
---

`function-used-as-a-tag` — a plain function where a component belongs

Ramonda's unit is the class. A function has nothing to construct, no state and no lifecycle, so in
tag position it names nothing the framework can keep hold of. `RMD011` reports it once the line runs.

**The reason this is a rule at all is measured, not assumed.** `JSX.ElementType` is deliberately
undeclared, so TypeScript applies its default rule — a tag must return one `JSX.Element`:

| the function returns | the compiler |
|---|---|
| several nodes | refused, `TS2786` |
| anything that is not a node | refused, `TS2786` |
| exactly ONE node | **accepted** |

The accepted shape is how a function component gets written out of habit, so the likeliest spelling
was the only one nothing typed caught. The report says which side of that line each finding is on,
so a reader meeting two messages about one line knows why there are two — and says NOTHING about
the compiler when it cannot tell. That third state was found by running the rule against a fixture
that already existed: `(props) => props.value` as a tag returns a string, so `TS2786` refuses it,
and a two-state answer had printed *the types let this shape through*.

All three are reported rather than only the third: this package does not typecheck, by design, and
runs over projects whose types are loose or absent — a rule that answered only where `tsc` is silent
would change its mind depending on somebody's build.

**None of this restricts arrays.** A component returning `[<td/>, <td/>]` is the framework's own
headline case and compiles; so does `{rows()}` in an expression slot. Only tag position is
constrained, and only because that is where the default rule applies.

Silent on a class, on an alias for one, on a value read off something (`<kit.Link />`, which is the
router's shape), and on a call in an expression slot — which is the answer, not the fault.
