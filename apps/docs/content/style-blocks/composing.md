---
title: Composing, and who wins
description: Merging one block into another, conditions and matches that bring whole groups or pick one value, and the cascade layer that decides against yours.
section: Style blocks
order: 114
---

# Composing, and who wins

A block is rarely one thing. A button has a base, a variant, a size and a couple of toggles — and a
toggle changes **groups of keys**, not just values.

A spread and a condition do that, both written inside the block, and both follow the same rule:
**later wins**, which is the rule you already have when you read CSS.

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
      <button className={@@(
        ...$(button);
        ...$(variants[this.variant]);

        when $(this.disabled) {
          opacity: 0.5;
          cursor: not-allowed;     /* wins over `cursor: pointer`, because it is BELOW it */
        }

        width: auto;
        when $(this.full) { width: 100%; }
      )}>press</button>
    );
  }
}
```

- **`...$(…)` merges another block here**, and it works across files. What it merges is a value, so
  it can be imported, put in an object, or picked out of one.
- **`when $(…) { … }` merges a group only when the condition holds.**

Both are arguments of the same merge, in the order you wrote them.

For a choice between several blocks you already have, spread a *lookup* — the one above, keyed by
the variant. TypeScript then checks the map covers the union, so adding a third variant and
forgetting the map is reported.

## Which one to write

Three forms, and each works at one level or both — a **group** is one or more whole declarations, a
**value** is what follows one property's `:`.

| | a group | a value |
|---|---|---|
| a condition | [`when $(…) { … } else when $(…) { … } else { … }`](#when-else-when-else) | [`$(…) ? a : b`](#a-choice-between-two-values), chainable |
| one value, several outcomes | [`match $(…) { k => ( … ); }`](#a-match-over-whole-groups) | [`match $(…) { k => v; }`](#match-one-value-several-outcomes) |

So a condition has one spelling at each level: `when` never stands in a value, and a choice never
picks a group. A value that applies only when something holds is a group of one declaration, in a
`when`; two declarations under one choice are a `when … else`.

## `when`, `else when`, `else`

A condition can go on, the way it does in JavaScript. **The first condition that holds brings its
group, and the rest are not asked:**

```tsx
class Field extends Component<{ state: "error" | "warning" | "ok" }> {
  render() {
    return (
      <input aria-label="Email" className={@@(
        border: 1px solid;

        when $(this.props.state === "error") {
          border-color: #ef4444;
        } else when $(this.props.state === "warning") {
          border-color: #f59e0b;
        } else {
          border-color: #d1d5db;
        }
      )} />
    );
  }
}
```

- **With no final `else`, nothing is brought when nothing holds**, and whatever was written above the
  chain stands.
- **An `else` belongs right after a `}` that closes a `when` or an `else when`.** Anywhere else — first
  in a block, after a declaration, after a final `else` — it is refused, because there is nothing for
  it to be the rest of.
- **`else` takes no condition of its own.** A branch with one is `else when $( … )`.
- The formatter writes each `else` on the line of the brace before it, as above.

When every branch compares one value with a few fixed ones, as this one does, a
[`match`](#a-match-over-whole-groups) says it shorter.

## `match` — one value, several outcomes

`when` chooses between whole groups. `match` chooses between **values of one property**:

```tsx
class Chip extends Component<{ tone: "hot" | "cold" | "quiet" }> {
  render() {
    return (
      <span className={@@(
        padding: 4px 10px;
        color: match $(this.props.tone) {
          hot   => #ff0055;
          cold  => #0ea5e9;
          _     => inherit;
        };
      )}>{this.props.tone}</span>
    );
  }
}
```

**Every arm is its own rule and its own class.** The stylesheet gets `.r-c-#ff0055`,
`.r-c-#0ea5e9` and `.r-c-inherit`, and at render the subject picks one of them. Nothing is built,
and nothing is written onto the element.

### It is a lookup table, not pattern matching

One expression, one value per arm. There is no destructuring, no guard and no custom matcher — if
you want those, compute the subject before the block and match on what comes out.

- **The keys are checked against the subject's type.** An arm for a value the subject can never hold
  is a fault on the key, and a missing one is a fault too unless there is a `_` — reported on the
  word `match`, naming the value with no arm. A subject typed as a plain `string` has no list to
  cover, so for it only the keys are asked.
- **`_` answers for everything the arms above did not.** Without it, a subject that names no arm sets
  **nothing at all**, and whatever was written above it stands — the same answer `when` gives.
- **An arm holds a literal.** `hot => $(this.x)` is refused (`hole-in-a-match-arm`): an arm carrying
  the render's own value would cost exactly what a match exists to avoid. A `$` variable is fine, and
  needs no import, because an arm is CSS.
- **An arm that can never run** (`match-arm-repeated`) and **a match with no arms**
  (`match-with-no-arms`) are reported.

### The subject is a string

An arm's key is a written word, so `match` takes a string. Against a number or a boolean, `1 =>` and
`true =>` would leave you asking whether the key is the value or its spelling — so either one is
refused on the subject, and the message says what to write instead:

- **a boolean** is a two-way choice, which has its own spelling:
  [`$(on) ? a : b`](#a-choice-between-two-values), and `when` for whole groups;
- **a number** becomes a word in code first: `match $(n > 2 ? "large" : "small") { … }`.

### A match over whole groups

The same lookup, with a group in each arm instead of one value. The arms go inside `{ }` and each
one's declarations inside `( … )` — the shape an arrow function has when it returns a value — and
every arm ends with `;`:

```tsx
class Badge extends Component<{ size: "small" | "large" }> {
  render() {
    return (
      <span className={@@(
        match $(this.props.size) {
          small => ( padding: 2px 6px; font-size: 12px; );
          large => ( padding: 6px 12px; font-size: 16px; );
        }
      )}>{this.props.size}</span>
    );
  }
}
```

Everything above holds for it: the keys are checked against the subject's type, `_` answers for the
rest, and every declaration in every arm is its own class, picked at render by one lookup.

- **An arm holds declarations and nested rules** — `hot => ( color: red; &:hover { color: darkred; } );`
  is fine. A condition, a spread or another match inside an arm is refused: an arm is a set of
  classes known when the block compiles. Write those beside the match instead.
- **An empty arm, `( )`, brings nothing** and still answers for its key, so `_` does not.

## A choice between two values

For one property and two values, write the choice where the value goes:

```tsx
class Input extends Component<{ invalid: boolean }> {
  render() {
    return (
      <input aria-label="Email" className={@@(
        border: $(this.props.invalid) ? 2px solid #ef4444 : 1px solid #d1d5db;
      )} />
    );
  }
}
```

Both values become classes and the condition picks one, exactly as a `match` arm does — so a branch
holds a value written out, or a `$` variable, and never a value from code (`hole-in-a-match-arm`).
The `:` is required; a value that applies only when the condition holds is a `when`.

Choices chain, and the first condition that holds picks the value. The formatter lays a chain out as
a table:

```tsx
declare const error: boolean;
declare const warning: boolean;

const field = @@(
  color: $(error)   ? #ef4444
       : $(warning) ? #f59e0b
       :              #111827;
);
```

Parens around a branch — `$(c) ? (2px solid red) : (1px solid #ccc)` — mean the same, and the
formatter takes them off.

## Why the condition is inside `$( )`

Because that is the one rule this syntax has: **TypeScript appears inside `$( )` and nowhere else.**
`when this.disabled` would be shorter and would be a second way for code to get into a block — and
the moment there are two, every reader has to learn which one a given line is. The word is `when`
rather than `if` because CSS has an `if()` of its own.

## What is checked in a group

Everything a block is checked for, a group is checked for the same way — a typo inside `when` is the
same error, with the same *did you mean*, that it is outside one.

**The condition is an ordinary expression and is not required to be a `boolean`.** It is the same
truthiness JavaScript's `if` has, and `when $(items.length)` is the shape people reach for; demanding a `boolean`
would refuse it for nothing. What is refused is a condition that can never be FALSE, because that is
a group that can never be off. A type that holds `false`, `0`, `""`, `null` or `undefined` is a
condition; one that holds none of them is a mistake.

| written | what happens |
|---|---|
| `when $(this.method)` — a method you forgot to call | reported: *a function is always truthy — call it, or test a value* |
| `when $(someObject)`, `when $("yes")`, `when $(items)` | reported: *this is always truthy, so the group can never be off* |
| `when $(maybeUndefined)` | fine — that is the shape a prop has |
| `when $(items.length)`, `when $(name)` | fine — `0` and `""` are false, so the group can be off |
| `...$(notABlock)` | reported: *only a style block can be spread* |
| `...$(base)` inside `&:hover` or a `@media` | reported — see below |

## Nesting, and a shorthand meeting its longhand

`when` nests, and a nested condition means both must hold. A selector inside a group and a group inside
a selector mean the same thing, so write whichever reads better.

One thing worth knowing, because CSS itself works this way: a **shorthand written later clears the
longhands it covers**. If a base sets `padding-left: 40px` and a modifier sets `padding: 8px`, the
modifier wins completely — which is what those two declarations would do in a plain stylesheet. The
other direction leaves both standing, also as CSS does. [Shorthands](/style-blocks/shorthands) covers the rest — the
few that stay whole, and the few that are refused.

That holds across the logical spellings too: `margin` sets all four sides whichever way the text
runs, so it clears `margin-inline`, `margin-block-start` and the rest.

**A spread goes at the top of a block, or inside `when`** — not inside a selector or a `@media`. It
merges a whole block, and a block carries the context each of its own declarations was written in, so
there is nothing sensible for a nested one to mean. A `when` is fine: it changes no declaration, it
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
rule in one, and that is decided **before** specificity is looked at. The same two declarations,
five ways:

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
const panel = <div className={mergeClassNames("panel", @@( padding: 12px; ))}>…</div>;
```

The element gets `padding: 0`. Not because of where the files load, and not because one selector is
stronger — the block is in a layer and `app.css` is not.

**This is on purpose, and it is a trade.** Adding blocks to a project that already has CSS does not
make you fight your own stylesheet: nothing has to be rewritten and no `!important` appears. What it
costs is CSS's own answer, where those two would be settled by whichever was written later.

Without the layer there is no stable answer to give. Which of the two wins would depend on which
stylesheet your bundler emits last — something you do not choose, and which can differ between a dev
server and a build. The layer replaces that with a rule you can read here.

## Letting a block win

Put your own CSS in a layer too, and say which order the layers go in. The same
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

**And the statement has to be seen FIRST.** A layer's place is fixed the first time the browser meets
its name, so a statement that arrives after `ramonda` is already established cannot move it — it can
only say where `app` goes, and `app` ends up last. The same `@layer app, ramonda;`, either way round:

```
your stylesheet first    12px    the block wins, which is what the statement asked for
the block's first         0px    the statement arrived too late; `app` went last
```

In practice that means putting the statement where nothing can load before it — the top of the
stylesheet your entry imports first, not beside the rules it applies to.

## What a block cannot hold is `@layer` itself

```tsx expect-report:layer-in-a-block
const a = <div className={@@(
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
