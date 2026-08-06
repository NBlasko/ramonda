---
"@ramonda/core": minor
---

**Breaking:** `@shouldUpdateOnPropsChange` is now the class decorator `@ShouldUpdateOnPropsChange`

```diff
+@ShouldUpdateOnPropsChange((self, previous, next) => previous.id !== next.id)
 @Host("li")
 class Row extends Component<RowProps> {
-  @shouldUpdateOnPropsChange
-  onlyWhenIdChanges(previous: RowProps, next: RowProps) {
-    return previous.id !== next.id;
-  }
   render() { … }
 }
```

`self` is inferred from the class it is written on, so nothing needs annotating — the same shape as
`@Host`'s tag-from-props callback. Capitalised, because a class decorator names what the component IS.

The move fixes two faults the method form could not avoid, both silent. A subclass overriding the
decorated METHOD without re-decorating ran the BASE's body, because the function was captured at
decoration time — there is no method to capture now. And declaring the rule at both levels, the
ordinary way to override it where `extends` is the composition mechanism, was reported as "more than
one … remove the others": the rule now lives on the constructor, so `Object.hasOwn` tells "declared
here" from "inherited", an override is silent, and two applications on ONE class are still reported.

Two smaller consequences: the rule is inherited through the static chain like `@Host`'s tag, and
putting it on a hook throws when the CLASS IS DEFINED rather than when something first renders it.
