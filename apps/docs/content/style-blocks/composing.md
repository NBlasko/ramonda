---
title: Composing, and who wins
description: Merging one block into another, conditions that bring whole groups, and the cascade layer that decides against your own stylesheet.
section: Style blocks
order: 111
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

## What is checked in a group

Everything a block is checked for, a group is checked for the same way — a typo inside `if` is the
same error, with the same *did you mean*, that it is outside one.

**The condition is an ordinary expression and is not required to be a `boolean`.** It is the same
`if` JavaScript has, and `if ({items.length})` is the shape people reach for; demanding a `boolean`
would refuse it for nothing. What is refused is a condition that can never be FALSE, because that is
a group that can never be off. A type that holds `false`, `0`, `""`, `null` or `undefined` is a
condition; one that holds none of them is a mistake.

| written | what happens |
|---|---|
| `if ({this.method})` — a method you forgot to call | reported: *a function is always truthy — call it, or test a value* |
| `if ({someObject})`, `if ({"yes"})`, `if ({items})` | reported: *this is always truthy, so the group can never be off* |
| `if ({maybeUndefined})` | fine — that is the shape a prop has |
| `if ({items.length})`, `if ({name})` | fine — `0` and `""` are false, so the group can be off |
| `...{notABlock}` | reported: *only a style block can be spread* |
| `...{base}` inside `&:hover` or a `@media` | reported — see below |

## Nesting, and a shorthand meeting its longhand

`if` nests, and a nested condition means both must hold. A selector inside a group and a group inside
a selector mean the same thing, so write whichever reads better.

One thing worth knowing, because CSS itself works this way: a **shorthand written later clears the
longhands it covers**. If a base sets `padding-left: 40px` and a modifier sets `padding: 8px`, the
modifier wins completely — which is what those two declarations would do in a plain stylesheet. The
other direction leaves both standing, also as CSS does.

That holds across the logical spellings too: `margin` sets all four sides whichever way the text
runs, so it clears `margin-inline`, `margin-block-start` and the rest.

**A spread goes at the top of a block, or inside `if`** — not inside a selector or a `@media`. It
merges a whole block, and a block carries the context each of its own declarations was written in, so
there is nothing sensible for a nested one to mean. An `if` is fine: it changes no declaration, it
only decides whether the whole thing lands.

## Logical and physical, in one block

`margin-inline` is the left and right margins when the text runs across, and the top and bottom ones
when it runs down. Which it is depends on `writing-mode`, and that is not known until the page is
laid out.

So a block that writes a physical side and then a logical one that might cover it is reported:

```
margin-left: 4px;
margin-inline: 8px;        ✗  whether this overrides the line above depends on writing-mode
```

Write both in one system — `margin-inline-start` and `margin-inline`, or `margin-left` and `margin`
— and the question does not arise. The other order is fine, and so is a four-side shorthand in
either position, because neither leaves anything for the layout to decide.

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

## What a block cannot hold is `@layer` itself

```tsx expect-report:layer-in-a-block
const a = <div css={@@(
  @layer buttons {
    color: red;
  }
)}>…</div>;
```

A layer written in a block would be a sublayer of `ramonda`, and CSS orders layers it was given no
explicit order for by first appearance. The stylesheet writes one file at a time, so which sublayer
wins would be decided by which file your bundler reached first — and there is nowhere inside a block
to write the `@layer a, b;` that would settle it. **It looks like a cascade control and cannot be
one**, so it is reported rather than emitted.

## Next

- **[Project settings](/style-blocks/settings)** — the names a block emits, and making the rules
  stricter.
- **[Tooling](/style-blocks/tooling)** — formatters, linters, and other JSX libraries.
