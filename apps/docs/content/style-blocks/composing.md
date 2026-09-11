---
title: Composing, and who wins
description: Merging one block into another, conditions that bring whole groups, and the cascade layer that decides against your own stylesheet.
section: Style blocks
order: 110
---

# Composing, and who wins

A block is rarely one thing. A button has a base, a variant, a size and a couple of toggles — and a
toggle changes **groups of keys**, not just values.

Two spellings do that, both written inside the block, and both mean the same: **later wins**, which
is the rule you already have when you read CSS.

```tsx
const button = @@(
  display: inline-flex;  align-items: center;  gap: 8px;
  border-radius: 6px;  font-weight: 600;  cursor: pointer;
  &:hover { filter: brightness(1.02); }
);

const variants = {
  primary:   @@( background: #10b981; color: #fff; &:hover { background: #0e9f6e; } ),
  secondary: @@( background: transparent; color: #10b981; box-shadow: inset 0 0 0 1px #10b981; ),
};

class Button extends Component {
  @state variant: "primary" | "secondary" = "primary";
  @state disabled = false;
  @state full = false;

  render() {
    return (
      <button css={@@(
        ...{button};
        ...{variants[this.variant]};

        if ({this.disabled}) {
          opacity: 0.5;
          cursor: not-allowed;     /* wins over `cursor: pointer`, because it is BELOW it */
        }

        width: {this.full ? "100%" : "auto"};
      )}>press</button>
    );
  }
}
```

- **`...{ … }` merges another block here**, and it works across files. What it merges is a value, so
  it can be imported, put in an object, or picked out of one.
- **`if ({ … }) { … }` merges a group only when the condition holds.**

Both are arguments of the same merge, in the order you wrote them.

**There is no `@else`, and what replaces it is better.** Spreading a *lookup* gives you
exhaustiveness: add a third variant to the union above and forget the map, and TypeScript reports it.
For a two-way choice of a single *value*, a hole with a ternary is still the answer.

## Why the condition is inside `{ }`

Because that is the one rule this syntax has: **TypeScript appears inside `{ }` and nowhere else.**
`if (this.disabled)` would read more naturally and would be a second spelling for the same thing —
and the moment there are two, every reader has to learn which one a given line is.

## The one place this is not plain CSS

Every rule is emitted inside `@layer ramonda`, and **a layer is the one thing here that behaves
differently from CSS written by hand.** It is worth two minutes, because it decides who wins.

A layer is a bucket, and buckets are ranked ahead of everything else — a rule in no bucket beats a
rule in one, and that is decided **before** specificity is looked at. Measured in Chromium, the same
two declarations five ways:

```
.a { color: red }  .b { color: blue }                  blue    the later one wins
.b { color: blue }  .a { color: red }                  red     the later one wins

.a { color: red }  @layer L { .b { color: blue } }     red
@layer L { .b { color: blue } }  .a { color: red }     red     order stops mattering
.a { color: red }  @layer L { p#q.b.c { color: blue } } red    specificity stops mattering too
```

So **your own stylesheet always wins**:

```css
/* app.css */
.panel { padding: 0 }
```

```tsx
const panel = <div className="panel" css={@@( padding: 12px; )}>…</div>;
```

The element gets `padding: 0`. Not because of where the files load, and not because one selector is
stronger — the block is in a layer and `app.css` is not.

**This is on purpose, and it is a trade.** Adding blocks to a project that already has CSS does not
make you fight your own stylesheet: nothing has to be rewritten and no `!important` appears. What it
costs is CSS's own answer, where those two would be settled by whichever was written later.

The alternative was measured and is worse: with no layer, the winner is whichever stylesheet your
bundler happens to emit last — which you do not choose, and which can differ between a dev server and
a build. **A predictable answer that is not CSS's beats CSS's answer to a question you cannot see.**

## Letting a block win

Put your own CSS in a layer too, and say which order the layers go in. Measured, the same
`.panel { padding: 0 }` against the same block:

```
.panel { padding: 0 }                                    0px    unlayered, so it wins
@layer app, ramonda;   @layer app { .panel … }          12px    app ranked first, so it loses
@layer ramonda, app;   @layer app { .panel … }           0px    app ranked last, so it wins
                       @layer app { .panel … }          12px    no statement: first seen is first
```

The `@layer a, b;` statement is what ranks them, and **a layer named later in it wins** — so
`@layer ramonda, app;` puts your CSS above the blocks, and `@layer app, ramonda;` puts it below.

Without that statement the order is whichever layer the browser meets first, which is the same
"your bundler decides" problem in a smaller box. Write the statement.

## Next

- **[Project settings](/style-blocks/settings)** — the names a block emits, and making the rules
  stricter.
- **[Tooling](/style-blocks/tooling)** — formatters, linters, and other JSX libraries.
