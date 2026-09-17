---
"@ramonda/css": patch
---

One mistake in a declaration is one finding, when a project narrows several things at once.

`literal-not-allowed` is the widest of the rules a config turns on — it fires on any written-out
value of a kind taken from variables — so it landed beside every narrower rule that also fired:

```
letter-spacing: 2rem     literal-not-allowed + unit-not-allowed
margin: 8px              shorthand-not-allowed + literal-not-allowed
padding: 1px 2px         too-many-values + literal-not-allowed
```

Each is one gesture by the author. The one kept is the outermost of the four, in the order the fixes
nest: which property, then how many values, then where the value comes from, then how it is spelt.
Reading the unit first is the case that shows why — it sends you to `2px`, which the same config
still refuses.

Two findings of the same rule are still two: `padding: 2rem 3em` names both units. Two declarations
still keep their own, and anything CSS itself refuses is untouched.
