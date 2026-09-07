---
title: Style blocks
description: Real CSS beside the markup, compiled before the build into one class per declaration, composed where you write it and type-checked throughout.
section: Across the app
order: 119
---

# Style blocks

[Styling](/styling) is the framework's position: a `className`, a `style`, and stylesheets the way
they have always arrived. This page is about the one thing built on top of it, and it is a separate,
opt-in package rather than part of the framework.

```tsx
<div css=@@(
  display: flex;
  gap: 8px;
  border-left: 4px solid #10b981;
)>
  Online
</div>
```

That is real CSS, written where the element is, and **compiled before the build**. What ships is a
class per declaration in a stylesheet and a `className` on the element. Nothing is parsed at runtime,
nothing is built per render, and the browser caches the stylesheet as a file like any other.

Blocks [compose](#composing-blocks): one merges into another, a group of declarations switches on and
off, and **what you wrote later wins** — the rule you already have when you read CSS.

> **Not released yet.** `@ramonda/css` lives in this repository at `0.0.0` and is not published. The
> page is here because the syntax and its guarantees are settled; the version number is what is not.

## What a block becomes

**Each declaration becomes one class**, named after what it does — so `display: flex` written
anywhere in your app is one rule, and an element carries one class per thing its block sets:

```html
<div class="r-disp-flex r-gap-8px r-bl-4px_solid_#10b981">
```

Two files writing the same CSS agree on the same classes without knowing about each other, because
the name is derived from the declaration and nothing else.

A class per declaration rather than per block is what makes [composition](#composing-blocks) possible
at all: merging two blocks keeps, per thing set, the one written later — and it can only do that if
each thing set has its own class to keep or drop.

Each file carries the rules it names in its own stylesheet, which is what lets a code-split route
stand on its own: a class whose rule lives only in another route's sheet renders unstyled the moment
that route loads alone. Where two sheets are identical the bundler dedupes them by content and it
costs nothing.

**Each `{{ … }}` becomes one CSS custom property on the element.** A value that differs per instance
costs a property rather than a rule:

```tsx
class Row extends Component {
  @state weight = 4;

  render() {
    return (
      <div css={@@(
        border-left: {{`${this.weight}px`}} solid #ff0055;
        &:hover { border-left-color: #00b37e; }
      )}>
        a row
      </div>
    );
  }
}
```

The nested `&:hover` is CSS's own nesting, resolved by the browser rather than by the compiler. Every
rule is emitted inside `@layer ramonda`, which sits beneath all unlayered CSS — so your own
`.row { border: none }` wins whatever order the files load in, and nobody has to reason about
specificity against generated output.

## Three ways to write one

```tsx
const one = <div css=@@( display: flex; )>bare</div>;
const two = <div css={@@( display: flex; )}>braced</div>;
const panel = @@( display: flex; );
const three = <div css={panel}>a value</div>;
```

They compile to the same class and differ only in where the value is written. **Reach for a braced one
whenever the tag has other props** — the reason is an editor limit rather than taste, and it is
[below](#which-spelling-gets-colours).

## Everything in it is checked

The syntax is not TypeScript, so the package owns a parser and a virtual-file layer — the same way
JSX is usable because somebody wrote the parser for it. What that buys is the checking:

- **A property that does not exist** is TypeScript's own *did you mean*, on the property.
- **A value the property does not take** is reported the same way, with the values it does take.
- **A hole is checked against the type the property accepts**, in the scope where it was written —
  `this.weight` resolves to the field beside it, because the expression stays where you put it.

## Where a hole may go

A custom property holds a **value**. That is the whole rule, and the three things it rules out are
worth writing down:

```
border-left: {{width}};             ✓  a value
{{name}}: 24px;                     ✗  a property name
&:{{state}} { … }                   ✗  a selector
{{on ? "display:flex" : ""}}        ✗  a whole declaration
```

The last one is refused rather than mangled: there is nothing to put a variable in, and a value
carrying a `;` is refused outright — on the server as well, where it would otherwise become real
declarations in the markup.

There is exactly one exception to the second line, and it is [below](#naming-something-the-whole-stylesheet-uses):
a name that came from `@@property( … )` may stand where a property name goes, because the compiler
generated that name and nothing else can write it.

### One value, read many times

Write the hole wherever you need the value. That is the whole answer for almost every block:

```tsx
declare const accent: string;

const card = @@(
  border-left: 4px solid {{accent}};
  background: {{accent}};
  color: {{accent}};
);
```

A hole belongs to the declaration it is written in, so this puts **three** custom properties on the
element rather than one, all holding the same value — a rule is shared by every element that names
it, so its variable cannot be named after anything but itself.

**Whether that matters is a number, and the number is small.** On a real block reading one value five
times, measured: the `style` attribute is 102 B written directly, and 24 B if you declare a custom
property once and read it. **Seventy-eight bytes an element.** On one card that is nothing; on a list
of a hundred rows it is 7.8 KB of markup, and then it is worth a line:

```tsx
declare const accent: string;

const row = @@(
  --accent: {{accent}};

  border-left: 4px solid var(--accent);
  background: var(--accent);
  color: var(--accent);
);
```

The three declarations below have no hole at all now, so they are static classes that dedupe with
every other block writing the same thing. **Reach for it when a block repeats across many elements,
not by default** — the direct form is shorter to read and to write, and 78 bytes is not a reason.

**The name is yours, and a custom property INHERITS.** `--accent` is set on the element and is
visible to everything inside it — measured: a descendant that reads `var(--accent)` and never sets
one picks up the ancestor's value, a descendant that sets its own shadows it, and an element outside
the subtree falls back. That is a feature when you mean it, and a collision when you do not: a card
setting `--accent` changes any descendant whose own block reads that name.

So pick a name you would be happy to see inherited, or one nobody else would write. The names the
compiler generates for holes never have this problem — `--r-<class>-0` is derived from the
declaration itself, so two different declarations can never agree on one by accident.

### The unit goes inside the hole

```
padding-left: {{`${n}px`}};          ✓  the hole carries its own unit
padding-left: calc({{n}} * 1px);     ✓  the arithmetic is CSS's
padding-left: {{n}}px;               ✗  reported
```

A hole becomes one custom property, and a `var()` is substituted as **tokens** — so the `12` and the
`px` in `var(--…)px` never become one length. Measured in a browser, with `--w: 12`:

| written | computed |
|---|---|
| `padding-left: var(--w)px` | **`0px`** |
| `padding-left: 8px; padding-left: var(--w)px` | **`0px`** — the fallback above it is lost too |
| `padding-left: calc(var(--w) * 1px)` | `12px` |
| `--w: 12px; padding-left: var(--w)` | `12px` |

Invalid at computed-value time is worse than invalid at parse time: the property falls back to its
initial value **and takes any earlier declaration of it with it**. So text written against a hole is
reported, on either side and whatever it is — a unit, a suffix, a `#` in front.

## Comments

A block is CSS, so its comment is CSS's:

```tsx
const card = @@(
  /* the dot is the level, and it is set from the theme */
  display: grid;
  gap: 8px;      /* matches the list beside it */
);
```

They are **stripped from the emitted rule**, which is right — a note explaining a decision to the
next person does not need to reach a browser.

**`//` is not a comment here, and it does not fail quietly.** CSS has no line comment, so the
characters are written into the stylesheet as they stand:

```
.r-3f96…{// why
  color:red;gap:8px;}
```

and the CSS compiler then refuses the **whole file** — measured, `SyntaxError: Unexpected token
Semicolon` — naming nothing about the block, the file or the line it came from. A build that fails
somewhere else entirely, for a comment. So it is reported before it gets there, as
`line-comment`, on the `//` itself.

**Inside a hole, a comment is TypeScript's**, because that is what a hole holds:

```tsx
const card = @@(
  color: {{/* the brand, not the accent */ "#ff0055"}};
);
```

## Naming something the whole stylesheet uses

A block is **one element's rule**. An at-rule that names something for everything is not that, and
written inside a block it compiles, nests inside the class rule, and does nothing at all —
`@keyframes slide { … }` becomes `.r-…{@keyframes slide{…}}`, which no browser resolves:

```
@media (min-width: 40rem) { … }     ✓  a condition on this element's rule
@supports (display: grid) { … }     ✓
@container (min-width: 20rem) { … } ✓
@keyframes slide { … }              ✗  reported
@font-face { … }                    ✗  reported
@property --brand { … }             ✗  reported
```

Those three get a block of their own instead, with the at-rule written into the opening:

```tsx
const slide = @@keyframes(
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
);

const card = @@(
  animation: {{slide}} 240ms ease-out;
);
```

**The rule goes to the stylesheet and the site becomes its name.** The name is a hash — a whole
`@keyframes` has no short spelling the way one declaration does — so the same animation written in
two files is one rule, and `slide` is an ordinary
binding, which is what makes the reference checkable: a typo is an unresolved identifier and
TypeScript reports it with its own *did you mean*. Written in a stylesheet instead, the name would be
a string on both sides and `animation: slidein` would be one typo away from silence.

A reference is resolved **when the file compiles**, not on the element: `{{slide}}` becomes the name
itself, so it costs no custom property. It has to be — `var()` takes a literal name, and a reference
that stayed a hole would compile to `var(var(--…))`, which resolves to nothing.

### A variable with a name TypeScript checks

A named `@@property` block is a binding like any other, so a variable can be declared once, typed,
and read wherever it is imported:

```tsx
export const accent = @@property(
  syntax: "<color>";
  inherits: true;
  initial-value: #10b981;
);

const card = @@(
  {{accent}}: #f05;
  background: var({{accent}});
);
```

A misspelling is not a CSS problem here, it is an unresolved name: `var({{ackcent}})` is
*Cannot find name 'ackcent'. Did you mean 'accent'?*, from TypeScript, with the suggestion it
already knows how to make.

**The binding has to be declared in the same file as the block that reads it.** `var()` resolves a
literal name, and a name is written in only when the compiler can see where it came from — which it
does by reading one file, so an `import` is not something it can follow:

```tsx expect-report:hole-as-a-variable-name
import { accent } from "./theme";

const card = @@(
  background: var({{accent}});
);
```

> `var()` takes a literal name, and a hole is a value — this compiles to `var(var(…))`, which
> resolves to nothing and drops the declaration in silence.

Measured in Chromium: `var(var(--name))` computes to nothing and the declaration is dropped, while
the declaration *beside* it in the same rule is applied — which is what makes it hard to see and why
it is refused rather than left to be noticed.

**Set it with the binding, not with the name it looks like.** `--accent: #f05` and
`var({{accent}})` are two different custom properties — the block generates its own name — so the
declaration would do nothing for the value you read, which would fall back to `initial-value`. That
is reported:

> `--accent` is set here, and `accent` is read as a binding below — those are two different custom
> properties, so this declaration does nothing for it. Write `{{accent}}: …` to set the one you read.

A plain `--name` you both set and read is ordinary CSS and is left alone.

**And a plain name you read by a typo of one you set is reported too**, which is the version of the
same mistake that needs no bindings at all:

```tsx expect-report:variable-read-by-another-name
const card = @@(
  --accent: #10b981;
  background: var(--ackcent);
);
```

> `--ackcent` is read here and this block sets `--accent` — did you mean `--accent`?

It speaks only about a name the block itself sets, and that limit is deliberate rather than a gap. A
custom property inherits, so `var(--brand)` reading something a global stylesheet or an ancestor
element set is correct CSS — and a block can see neither. A rule that named every variable it could
not find would report code that works, so it says nothing about a name it has no evidence about, and
`var(--nothing-sets-this)` is left alone.

### A font, and a property you can animate

```tsx
const brand = @@font-face(
  font-family: "Brand";
  src: url("/brand.woff2") format("woff2");
  font-display: swap;
);

const angle = @@property(
  syntax: "<angle>";
  inherits: false;
  initial-value: 0deg;
);

const turn = @@keyframes(
  from { {{angle}}: 0deg; }
  to { {{angle}}: 180deg; }
);

const dial = @@(
  transform: rotate(var({{angle}}));
  animation: {{turn}} 1.2s linear infinite;
);
```

`@@font-face` names nothing — the `font-family` inside it is the handle, and that is the string other
rules match on, so its block is written for its own sake. The other two name something, and
`@@property` names a **custom** property, so what it compiles to is `--r-…` with the dashes: that is
the one name a hole may stand in, which is how the frames above set it.

Registering it is what makes it animate at all. Measured in Chromium: an unregistered custom property
flips from one frame to the next, and the block above passes exactly 90° at half time — an angle CSS
could only reach by interpolating.

### What is checked, and by whom

Each of the three has its own vocabulary, and the check follows it:

| written | what happens |
|---|---|
| `opacty: 1` in a frame | reported — a frame holds ordinary properties |
| `form { … }` | reported — a frame is `from`, `to` or a percentage |
| `opacity: 0` outside any frame | reported — it belongs to no time, so the browser drops it |
| `@@font-face` with no `src` | reported — the descriptor is required, and the face would load nothing |
| `font-familly: "Brand"` | reported, with the descriptor you meant |
| `@@property` with no `inherits` | reported — measured, the browser drops the whole rule without it |
| `&:hover { … }` in either | reported — a descriptor list has no element to select against |

A hole may not go in one of these blocks otherwise: a hole is a custom property **on an element**, and
these name something the whole stylesheet uses, so there is no element for the value to come from.

## The names

A class name says what its rule does. It is `r-`, a short spelling of the property, a `-`, and the
**value as you wrote it** — spaces written `_`, because a class name cannot hold one.

```
padding: 12px            r-p-12px
display: inline-flex     r-disp-inline-flex
opacity: .5              r-o-.5
padding: 4px 0           r-p-4px_0
outline-offset: 4px      r-outline-offset-4px
```

About sixty properties have a short spelling — `p`, `m`, `w`, `h`, `bg`, `c`, `gap`, `items`,
`rounded` — and the rest use their own name, which already reads. It is a small list on purpose: a
short form nobody recognises is worse than the property's own name, because it is shorter *and* has
to be learned.

**The value is written exactly as you wrote it, and that is not a nicety.** `opacity: .5` and
`opacity: 5` are both valid CSS, and anything that tidied the `.` away would give them one class —
two rules merged into one, on a page nobody edited.

Where a declaration sits is written in front of it:

```
&:hover { color: red }                    r-:hover-c-red
&::after { width: 10px }                  r-::after-w-10px
& .title { font-weight: 600 }             r-_.title-fw-600
@media print { color: red }               r-@media_print-c-red
```

The `_` before `.title` is the space in `& .title` — it is what separates a descendant from `&.title`,
which is a different element and a different class.

### Why some are still a hash

```
r-QbofRLj5j
```

Four reasons, and each one is a name that could not be written rather than a preference:

- **the declaration carries a hole** — its value is a custom property, not text you wrote;
- **the name would be too long** — over 32 characters, which in practice means a `transition` or a
  `grid-template` with several parts;
- **the value or the context holds a character a class name cannot** — a quote, most often;
- **the selector is a list** — `&:hover, &:focus` is two selectors sharing a body, and there is no
  one spelling for it.

A hashed name is exactly as correct as a readable one. It is only less pleasant to read, which is why
the readable half can grow without anything else changing.

**The one thing you can act on**: a shorter value is a shorter class. Splitting a long `transition`
into its longhands gives you three readable names instead of one hash.

### In the stylesheet they look escaped

```css
.r-bg-\#10b981 { background: #10b981 }
```

That backslash is CSS's own: in a selector a `#` starts an id, so a class name holding one has to say
it means a `#`. The markup carries the name without it, which is what you see in devtools and what
you would grep for.

## Composing blocks

A block is rarely one thing. A button has a base, a variant, a size and a couple of toggles — and the
toggles change **groups of keys**, not only values. Two spellings do that, both inside the block, and
both mean the same thing: **later wins**, which is the rule you already have when you read CSS.

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
        ...{{button}};
        ...{{variants[this.variant]}};

        @@if {{this.disabled}} {
          opacity: 0.5;
          cursor: not-allowed;     /* wins over `cursor: pointer` above, because it is BELOW it */
        }

        width: {{this.full ? "100%" : "auto"}};
      )}>press</button>
    );
  }
}
```

**`...{{ … }}` merges another block here**, and it works across files — what it merges is a value, so
it can be imported, put in an object, or picked out of one. **`@@if {{ … }} { … }` merges a group only
when the condition holds.** Both are arguments of the same merge, in the order you wrote them, so
what comes later wins.

There is no `@else`, and the thing that replaces it is better: spreading a **lookup** gives you
exhaustiveness. Add a third variant to the union above and forget the map, and TypeScript reports it.
For a two-way choice of a *value*, a hole with a ternary is still the answer.

### Why the condition is inside `{{ }}`

Because that is the one rule this syntax has: **TypeScript appears inside `{{ }}` and nowhere else.**
`@@if (this.disabled)` would read more naturally and would be a second spelling for the same thing —
a second thing to learn, and a second thing for every tool to know about.

And `@@if` rather than `@if` because **`@@anything` can never become CSS**: an at-rule is `@` followed
by a name, and a name cannot start with `@`. `@if` is free today and that is all it is.

### What is checked

Everything a block is checked for, a group is checked for the same way — a typo inside `@@if` is the
same error, with the same *did you mean*, that it is outside one.

**The condition is an ordinary expression and is not required to be a `boolean`.** `@@if` is an `if`,
and `@@if {{items.length}}` is the shape people reach for — demanding a `boolean` would refuse it for
nothing. What is refused is a condition that can never be FALSE, because that is a group that can
never be off: an object, an array, a function you forgot to call, a promise, a string or number
*literal*. A type that holds `false`, `0`, `""`, `null` or `undefined` is a condition; one that holds
none of them is a mistake.

On top of that:

| written | what happens |
|---|---|
| `@@if {{this.method}}` — a method you forgot to call | reported: *a function is always truthy — call it, or test a value* |
| `@@if {{someObject}}`, `@@if {{"yes"}}`, `@@if {{items}}` | reported: *this is always truthy, so the group can never be off* |
| `@@if {{maybeUndefined}}` | fine — that is the shape a prop has |
| `@@if {{items.length}}`, `@@if {{name}}` | fine — `0` and `""` are false, so the group can be off |
| `...{{notABlock}}` | reported: *only a style block can be spread* |
| `...{{base}}` inside `&:hover` or a `@media` | reported — see below |

### Nesting, and a shorthand meeting its longhand

`@@if` nests, and a nested condition means both must hold. A selector inside a group and a group
inside a selector mean the same thing, so write whichever reads better.

One thing worth knowing, because CSS itself works this way: a **shorthand** written later clears the
longhands it covers. If a base sets `padding-left: 40px` and a modifier sets `padding: 8px`, the
modifier wins completely — which is what the same two declarations would do in a plain stylesheet.
The other direction leaves both standing, also as CSS does.

**A spread goes at the top of a block, or inside `@@if`** — not inside a selector or a `@media`. It
merges a whole block, and a block carries the context each of its own declarations was written in,
so there is nothing sensible for a nested one to mean. A `@@if` is fine: it changes no declaration,
it only decides whether the whole thing lands.

### The one place the stylesheet decides instead of you

Everything above is decided where you wrote it. There is one exception, it is reported rather than
silent, and it is worth understanding once.

A stylesheet has **one** order, and a rule in it is shared by every element that names it — so it
cannot follow any single block's order. It emits unconditional rules before conditional ones, which
is what makes the ordinary shape right:

```tsx
const card = @@(
  padding: 8px;
  @media (min-width: 40rem) { padding: 24px; }   /* wins on a wide screen, as you would expect */
);
```

Write those two the other way round and the `@media` still wins — your `padding: 8px` below it
cannot take effect, because its rule is emitted first. That is reported:

> `padding` is written to override `@media (min-width: 40rem)` above it, and it will not — the
> stylesheet emits conditional rules after unconditional ones, so the earlier one wins wherever both
> apply. Write it above, or put it under the same condition.

A condition written **on a selector** — `@media { &:hover { … } }` — is not affected, because a
selector adds specificity and that beats source order on its own.

## Theming

**A theme is custom properties, and a block reads them.** Nothing here is a theme system, and that is
the same position [styling](/styling) takes: the theme lives in an ordinary stylesheet, and switching
it is one attribute on `<html>` — no render, no JavaScript per element, and the block does not know a
theme exists.

```css
:root                  { --accent: #10b981; --surface: #ffffff; }
[data-theme="dark"]    { --accent: #34d399; --surface: #0b0b0b; }
```

```tsx
const card = @@(
  background: var(--surface);
  border-left: 4px solid var(--accent);

  &[data-theme="dark"] {
    box-shadow: none;
  }

  @media (prefers-color-scheme: dark) {
    border-left-color: var(--accent, #34d399);
  }
);
```

Four things a block does with a theme, and each one compiles to exactly what it says:

| written | what is emitted |
|---|---|
| `color: var(--accent)` | `color:var(--accent)` |
| `color: var(--accent, #10b981)` | the fallback, untouched |
| `--card-bg: var(--surface)` | the block naming its own value from the theme's |
| `&[data-theme="dark"] { … }` | `.r-… [data-theme=dark]`, after the build flattens it |

### A hole is not a theme

It is tempting, because a hole and a `var()` are the same thing underneath — a hole compiles to
`var(--r-<hash>-0)` and the element carries the value. The difference is who sets it, and it decides
the cost.

**Measured on a server render of 500 rows with one themed value:** through a hole the markup went from
19.4 KB to 39.9 KB — **41 bytes on every element**, and that is one themed value. Through `var()` it is
nothing, because the value is on `:root` and each element inherits it.

And a theme switch through a hole is a **render**. A hole's value is a value of that render, so every
element carrying it has to render again to change it; a `var()` changes when the attribute on `<html>`
changes, which is not a render at all.

A hole is for what varies per **instance** — `border-left: {{`${this.weight}px`}}`, a value this
element has and the one beside it does not. A theme is the opposite of that.

### `:root` does not work inside a block

```
:root { --accent: red; }        ✗  inside a block
```

It compiles, and then does nothing. Measured through the same CSS compiler a build uses, it flattens
to `.r-… :root` — a descendant selector, and `:root` is the `<html>` element, which is nobody's
descendant. The theme's own declarations belong in a stylesheet.

## Setting up the build

One plugin, and there is no stylesheet to import: the CSS is a module the bundler already knows
about, and it follows the JavaScript chunk it belongs to.

```ts
import { ramondaCss } from "@ramonda/css/vite";

export const plugins = [ramondaCss()];
```

esbuild builds the same thing:

```ts
import { ramondaCss } from "@ramonda/css/esbuild";

export const plugins = [ramondaCss({ filter: /src\/.*\.tsx$/ })];
```

`filter` is worth setting. esbuild hands a plugin a **path** rather than the code, so a file has to be
read to be asked whether it holds a block — measured at 17 µs a file, and pointing the plugin at the
tree that holds them means nothing else is read at all.

**A route that is already code-split gets its own stylesheet.** A block belongs to the module it was
written in and each module imports its own CSS, so splitting is a decision the bundler was making
anyway — measured on a real build: a lazily-loaded module produced its own `.css` asset, carrying
that module's rule and not the entry's.

## Setting up your editor

Three things, and they are separate on purpose.

**The compiler, for completion, hover and the red squiggles.** A TypeScript language-service plugin,
turned on in your own `tsconfig.json`:

```json
{ "compilerOptions": { "plugins": [{ "name": "@ramonda/css/plugin" }] } }
```

Your editor has to be running the **workspace's** TypeScript for a plugin to load at all — in VS
Code, *TypeScript: Select TypeScript Version → Use Workspace Version*.

**One setting, and it is not optional:**

```json
{ "typescript.tsserver.useSyntaxServer": "never" }
```

An editor runs **two** TypeScript servers — a syntax one for what needs no types, and a semantic one
for everything else — and **only the semantic one loads plugins**. So the syntax server reads your
file, which is not TypeScript, and walks into an internal assertion. Taken from a real editor's own
log:

```
[error] [vscode.typescript-language-features] provider FAILED
[error] Error: <syntax> TypeScript Server Error (5.9.3)
Debug Failure. False expression: Token end is child end
```

Nothing in a plugin can reach it. The setting is what stops the editor asking it.

**The colours, and format-on-save**, come from an editor extension rather than from the plugin —
colours are a grammar and cost nothing, and a project that has not asked for the compiler should not
get one. The extension is not published yet; from a checkout it is
`node packages/css/vscode/install.mjs`, and then:

```json
{
  "[typescriptreact]": { "editor.defaultFormatter": "ramonda.ramonda-css-vscode" },
  "editor.formatOnSave": true
}
```

## Which spelling gets colours

An editor stops consulting syntax injections the moment it enters a tag's attribute list. Measured
with a grammar that does nothing but match one word: it colours a **first** attribute and is never
asked about a second. So a bare block is coloured only as the first attribute on the tag name's own
line, and everywhere else the file reads exactly as it would with nothing installed.

That is what the braced spelling is for. Inside the braces JSX already has for an expression there is
no such limit — any attribute, any line — and the plugin says so where it matters: a bare block an
editor cannot colour is marked as a **suggestion**, on the attribute name. A suggestion rather than a
warning, because nothing is wrong: the block compiles and is checked either way, and a build has no
business failing over colours.

## Formatters and linters

No tool that parses TypeScript can read a file holding a block until it is taught, and each of them
refuses rather than mangles — which is the safe half, and useless on its own:

| tool | what it says |
|---|---|
| biome | *Code formatting aborted due to parsing errors* |
| Prettier | *SyntaxError: ')' expected* |
| oxlint | refuses at the parse step |
| esbuild, `tsc` | refuse at the parse step |

A suppression comment cannot help either: `biome-ignore` is read **by** the parser that already
failed.

**Prettier gets a plugin.** Add it to your Prettier config and formatting works everywhere, including
the format-on-save your editor does for you:

```json
{ "plugins": ["@ramonda/css/prettier"] }
```

One thing it changes: a bare `css=@@( … )` comes back as `css={@@( … )}`. Prettier prints a quoted
attribute value itself and never offers a plugin the chance to print one, so the placeholder has to
be braced — and the two compile to the same class anyway.

**biome and oxlint get wrappers**, because they have no plugin surface for a syntax they cannot
parse:

```bash
ramonda-css format src        # your biome, your config
ramonda-css lint src          # your oxlint, your rules
```

Each replaces every block with something that parses, runs your own tool, and puts the block back at
the indentation the tool chose. Exclude the files that hold a block from those tools' own runs, or
they will refuse the file before a wrapper can help.

**And the editor formats the buffer, not the file.** `ramonda-css format --stdin-file-path <path>` is
what the extension runs — an editor asks a formatter about the text on screen, and a formatter
pointed at a path would format what was last saved and hand back edits computed against text you have
since changed.

## In another JSX library

The compiled value is a value, and this framework's `css` prop is only one way to apply it. One
exported function turns it into what any library already understands:

```tsx
import { toStyleObject } from "@ramonda/css";

const panel = @@(
  display: flex;
  gap: 8px;
);

const row = <div {...toStyleObject(panel)}>a row</div>;
```

`toStyleObject` returns `{ className, style }` — the generated class, and one entry per hole. There
is no wrapper component to write and nothing to copy: it is a dozen lines, exported from the package,
and it is the whole adapter surface.

Since a block is an ordinary expression it can also be written where it is used:

```tsx
import { toStyleObject } from "@ramonda/css";

const row = <div {...toStyleObject(@@( display: flex; ))}>a row</div>;
```

**It does two things a spread cannot do for itself**, and both are the reason it exists rather than
`{ className: value.className, style: … }` written by hand. A hole whose value is missing is left
out, rather than written as the text `undefined`, which is a value CSS keeps. And a value holding a
`;` is refused, because a spread ends up in a `style` attribute and a server-rendered page is parsed
back from HTML — measured, such a value came out of that round trip as real, applied declarations.

**What you give up by spreading**, and it is why this framework has a prop instead: `className` and
`style` become ordinary props, so the block's class merges with whatever else writes `className` by
whoever wrote it last, and its custom properties collide with an author's own `style`. The `css` prop
is one writer of one attribute, which is a race nobody has to think about.

## What it does not do

**It is not CSS-in-JS.** Nothing about a block is JavaScript: it is compiled away before the bundle,
the class exists in a file the browser can cache, and no style is rebuilt on a render.

**It does not scope your other CSS.** A `className` is still the string you wrote, and the class in
your source is the class in the served HTML — see [styling](/styling).

**It is not a theme system.** A theme is a context and some custom properties, which needs nothing
from the compiler.

**It does not decide anything from the order of your classes.** Nothing can — the order of names in a
`class` attribute has no meaning in CSS, which is exactly why composition merges maps rather than
concatenating class names. What decides is where you wrote something, and that is the whole point.

## Next

- [Styling](/styling) — `className`, `style`, and where stylesheets come from.
- [Performance](/performance) — why a value built in the markup costs more than it looks.
- [JSX](/concepts/jsx) — the rest of the attribute surface.
- [Diagnostics](/reference/diagnostics#rmd062-a-style-block-was-applied-with-no-values-for-its-holes)
  — what the runtime says when a value reaches it that no transform produced.
