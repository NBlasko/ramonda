---
"@ramonda/css": minor
---

`ramonda-css format` lays out the expression inside a hole, through your own formatter.

```
before   color: {this.toggle ? $.color.accent.quiet    : $.color.accent.main};
after    color: {this.toggle ? $.color.accent.quiet : $.color.accent.main};
```

The braces were closed up and the interior was left alone, so the one part of a block that is
ordinary TypeScript was the one part escaping the formatter — while this command exists precisely so
a file carrying blocks is laid out by the project's own tools.

The expression is handed to the same formatter alone, wrapped as a statement, and unwrapped. Two
answers are declined and the author's text is kept: one that spans lines, because the layout puts a
hole on one line and could not place it; and a formatter that throws, because a broken `biome.json`
is a setup fault rather than a reason to lose an expression.

Only `format` does this. The checker, the linter and the editor read the author's text unchanged.
