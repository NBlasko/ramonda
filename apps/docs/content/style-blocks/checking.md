---
title: What is checked
description: Every fault a block can carry, reported where you wrote it — and the one way to say a rule is wrong about your line.
section: Style blocks
order: 108
---

# What is checked

The syntax is not TypeScript, so the package owns a parser and a virtual-file layer — the same way
JSX is usable because somebody wrote the parser for it. That layer is what buys the checking: a fault
in a block arrives as an ordinary `tsc` diagnostic, on the character you wrote, in your own file.

## Running it

The checker takes a project, not a file — every block becomes a virtual file and the whole program
goes to `tsc` once, which is what makes a report land on your own character:

```sh
npx ramonda-css                 # the `tsconfig.json` beside you
npx ramonda-css app/tsconfig.json
```

There is no `check` verb: the bare command IS the check, and `format`, `lint`, `codegen` and
`explain` are the ones that are not. It exits non-zero when it reports anything, so it is a CI step
as it stands.

## What your editor tells you

- **A property that does not exist** is TypeScript's own *did you mean*, on the property.
- **A value the property does not take** is reported the same way, with the values it does take.
  A property whose grammar admits a name nobody can judge — `animation-name: slidein` is yours to
  pick — is left alone. A `url()` or a quoted string in the value does not make it one:
  `cursor: url(a.cur), pointerr` is still reported, on `pointerr`.
- **A runtime value in a declaration is refused** — `color: $(this.brand)` — and the message names
  the two things to use instead: a [`match`](/style-blocks/composing#match-one-value-several-outcomes) for a value that is one
  of a few, and [`@@property`](/style-blocks/dynamic) for one that really comes from data.
- **An expression is checked in the scope where it was written**, wherever `$( … )` is allowed:
  a condition, a spread, a `match` subject. `this.loud` resolves to the field beside it, because the
  expression stays where you put it.
- **A condition or a selector spelled two ways** is reported, with the spelling to use.
  `@media (min-width:40rem)` and `@media (min-width: 40rem)` are the same CSS, so writing both is
  writing two of what should be one thing.
- **A quoted value on a property with no place for a string** is reported. Your editor completes a
  value from a real union the way it completes any string literal, so `color: "yellow"` is an easy
  thing to end up with — and it compiles, ships `color:"yellow"`, and is dropped by every browser.
  `content: "hi"` and `font-family: "Brand"` are correct CSS and stay silent, because the question is
  asked of each property's own grammar.

## One spelling

Two spellings of the same CSS are two things to search for and two to keep in step. Where a
declaration, a condition or a selector has a canonical form, the other one is reported and
`ramonda-css format` writes the canonical one:

```tsx expect-report:non-canonical-spelling
const card = @@(
  COLOR: red;
  @media (min-width:40rem) { color: blue; }
);
```

Both of those are correct CSS — a browser reads `COLOR` and `color` as one property, and a media
query with no space after the colon is the same query. What they cost is a second thing to grep for.

CSS does not mind either. Your repository does.

## Inside a named block, the vocabulary is its own

`@@keyframes`, `@@font-face` and `@@property` each hold something different from an element's rule,
and the check follows that:

| written | what happens |
|---|---|
| `opacty: 1` in a frame | reported — a frame holds ordinary properties |
| `form { … }` | reported — a frame is `from`, `to` or a percentage |
| `opacity: 0` outside any frame | reported — it belongs to no time, so the browser drops it |
| `@@font-face` with no `src` | reported — the descriptor is required, and the face would load nothing |
| `font-familly: "Brand"` | reported, with the descriptor you meant |
| `@@property` with no `inherits` | reported — the browser drops the whole rule without it |
| `@@property` with no `initial-value` | reported — the browser drops the whole rule, unless the `syntax` is `"*"` |
| `initial-value` its `syntax` does not accept | reported — the browser drops the whole rule for that too |
| a registered property set to a value its `syntax` refuses | reported — the browser keeps the `initial-value` and says nothing |
| `&:hover { … }` in either | reported — a descriptor list has no element to select against |

An expression may not go in one of these at all: these name something the whole stylesheet uses, and
there is no element for a value to come from.

**A media feature that will never match is the row worth pausing on**, because it is not invalid
CSS. A browser reads `@media (min-widht: 40rem)`, keeps the rule, and never matches it — so every
declaration inside is inert and nothing else has any reason to complain.

## When a rule is wrong

**Every rule here fails the build.** There is no warning level, and that is deliberate: a warning
nobody must act on is a warning nobody reads.

So there is one way to say *I looked at this and it stays*:

```
/* ramonda-css-ignore a vendor stylesheet defines this one */
display: flexx;
```

It covers **the next line only**, so it cannot creep past what you looked at. It works in a `//`
comment too, for a finding about the block itself rather than about a line in it.

**A reason is required.** A directive with nothing after it is refused, and does not exempt the line
below it either:

> a `ramonda-css-ignore` with no reason after it is a silence, not a record.

And every one is printed on every run, whether or not anything failed:

```
[ramonda-css] 1 `ramonda-css-ignore`, honoured:

  src/Card.tsx:12  a vendor stylesheet defines this one
```

That is what makes it a record rather than a silence. A reason that has stopped being true is one
somebody meets, instead of one they would have to go looking for.

## What your project adds to that

Everything above is CSS being checked against itself, and it needs no config. A
[`ramonda.css.ts`](/style-blocks/config) adds reports that are yours rather than CSS's — a unit this
project does not use, a value outside a list it gave, a shorthand it switched off, a colour written
out where it takes colours from variables, a `$` path it does not declare. Each is a row in the
table below, and each fails the build the same way.

**If that file cannot be read, your editor says so on the block.** The completions keep working, but
nothing is being checked against rules that did not load, and a green file would be a claim the tool
cannot support:

> `[config-not-read]` … does not parse: TS1136: Property assignment expected.
> Until it reads, none of this project's rules are running — this block is not being checked
> against them, and a build will refuse before it gets here.

## Every rule

A typo in one of these ids is caught too: writing `unknown-unti` in
[`ramonda.css.ts`](/style-blocks/settings) tells you so, and names the one you meant.

[css-rules:start]: # "generated by scripts/build-rule-tables.mjs — edit the lines there"

Every one of them fails the build. 59 of them, and each is a key you can switch off — except `block-in-a-template`, which names no key because there is nothing safe to switch off: a block inside a `${ … }` reaches the bundler as `@@(`, and silencing the report would ship that.

| rule | reported when |
|---|---|
| `unknown-property` | a property name that is nearly one CSS has |
| `unknown-value` | a word this property does not take |
| `repeated-declaration` | the same property set twice to the same value |
| `hole-out-of-place` | a hole where CSS needs text, like a property name |
| `block-as-a-jsx-attribute` | `className=@@( … )` — a block is a value, so it goes in the braces |
| `block-in-a-template` | a block inside a template literal's `${ … }`, where nothing can see it — use `mergeClassNames` |
| `run-on-declaration` | a missing `;`, so the next line joined this value |
| `line-comment` | a `//` comment, which CSS does not have |
| `unknown-unit` | a unit CSS does not have |
| `glued-hole` | text written against a hole, which is not part of its value |
| `at-rule-out-of-place` | an at-rule that names something for the whole stylesheet |
| `unknown-frame` | a keyframe selector that is not one |
| `declaration-out-of-place` | a declaration where only a rule belongs |
| `rule-out-of-place` | a nested rule where only declarations belong |
| `override-out-of-order` | a declaration written to override one that will win anyway |
| `variable-set-by-another-name` | a `var()` reading a name set with different capitals |
| `hole-as-a-variable-name` | a hole naming a custom property rather than holding a value |
| `initial-value-and-syntax` | `@@property` with no `initial-value`, or one its `syntax` does not accept — the browser drops the rule |
| `unknown-media-feature` | a media feature that will never match |
| `value-and-registered-syntax` | a value a registered custom property cannot hold |
| `unit-not-allowed` | a unit your `ramonda.css.ts` does not allow |
| `value-not-allowed` | a value outside the closed list your `ramonda.css.ts` gave this property |
| `shorthand-not-allowed` | a shorthand your `ramonda.css.ts` switched off — write its longhands |
| `word-out-of-its-longhand` | a word one longhand of a shorthand has no place for — CSS drops the whole declaration |
| `narrower-after-a-whole-shorthand` | a narrower shorthand after a wider one, both reaching the stylesheet whole — no order keeps it winning |
| `resets-differ-across-engines` | a shorthand browsers reset differently, like `-webkit-mask` — the line renders two ways; write `mask` |
| `value-differs-across-engines` | a value browsers read differently, like `animation: auto` — the line renders two ways |
| `string-not-allowed` | a quoted value where the property takes a keyword |
| `property-not-a-name` | a value that must name a property and does not |
| `non-canonical-spelling` | one CSS written two ways — `ramonda-css format` fixes it |
| `layer-in-a-block` | `@layer` inside a block, which the sheet already decides |
| `root-in-a-block` | `:root` or `html` inside a block, which puts the root under the element — it applies nowhere |
| `spread-out-of-place` | `...$(block)` somewhere a whole block cannot go |
| `hole-in-a-named-block` | a hole in `@@keyframes( … )` and its kind, which have no element |
| `unknown-named-block` | `@@name( … )` where the name is not a site this compiles |
| `composition-in-a-named-block` | `...$(block)` or `when` inside a named site, which composes nothing |
| `ignore-without-a-reason` | `ramonda-css-ignore` with nothing after it |
| `unknown-prefix` | a vendor prefix that is not one of the four |
| `unknown-at-rule` | an at-rule name CSS does not have |
| `unknown-selector` | a pseudo-class or pseudo-element that is not one — the whole rule is dropped |
| `unknown-flag` | a `!` at the end of a value that is not `!important` |
| `unclosed-call` | a `(` in a value that no `)` closes — the value runs past the end of the block |
| `unknown-variable` | `$group.…` naming a variable your `ramonda.css.ts` does not declare |
| `variable-by-hand` | `var(--…)` written by hand for a variable your `ramonda.css.ts` declares — write `$group.…` |
| `too-many-values` | more values than the property takes — in CSS, or in your `ramonda.css.ts` |
| `missing-semicolon` | a declaration with no `;`, which swallows the line written under it |
| `literal-not-allowed` | a value written out where your `ramonda.css.ts` takes that kind from variables |
| `declaration-does-nothing` | a declaration another one on the same element switches off — valid CSS the browser ignores |
| `style-prop-never-used` | a prop that takes a style block and never puts it on an element |
| `style-prop-overridden` | a declaration below the spread that clears what a caller may send |
| `registered-never-set` | a `@@property` a block reads and nothing sets, so every element gets its initial value |
| `blocks-joined-not-merged` | two style blocks joined into one string, where `mergeClassNames` was meant — every class from both lands |
| `allow-list-not-css` | a value in an allow-list that is not CSS — every caller sending it is refused |
| `state-is-a-tuple` | a state in an allow-list typed `[{ … }]`, which constrains its first declaration and nothing under it |
| `allow-list-is-an-interface` | an allow-list written with `interface`, which can never match a block shape — write it as a `type` |
| `hole-not-allowed` | a runtime value in a declaration — write it out with `match`, or declare it with `@@property` |
| `hole-in-a-match-arm` | an arm holding a value the render computes, where a class belongs |
| `match-arm-repeated` | an arm that can never run, because one above it answers first |
| `match-with-no-arms` | a `match` that sets nothing whatever its subject is |

[css-rules:end]: #

## Next

- **[The config file](/style-blocks/config)** — switching a rule off, and making the rest
  stricter than CSS is.
- **[Tooling](/style-blocks/tooling)** — what your formatter and linter can and cannot read.
