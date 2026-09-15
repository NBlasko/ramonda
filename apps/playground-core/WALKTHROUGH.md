# Changing `ramonda.css.ts`, and watching the code change with it

This app has a real `ramonda.css.ts`. Every constraint in it reaches three places — the types, the
editor's suggestions, and the check — and this file is a list of edits to make so that each of those
can be **seen** rather than believed.

Run the check after every edit:

```sh
pnpm --filter @ramonda/playground-core check-types
```

It runs codegen first, so there is never a second command and never a stale answer.

In the editor, the plugin has to be loaded: *TypeScript: Select TypeScript Version → Use Workspace
Version*, and `"typescript.tsserver.useSyntaxServer": "never"` in the project's settings.

---

## 1. Take a property away

In `properties`, add:

```ts
"*": { shorthand: false },
```

**What should happen.** Every shorthand stops existing — `padding`, `margin`, `border`, `background`
and 94 others. `padding-left` is unaffected, and that is the point of the setting.

- In the editor, put the caret on a blank line inside a block. `padding` is **not** in the list and
  `padding-left` is. The property names come from TypeScript reading the block's own type, so there
  is nothing separate to keep in step.
- Write `padding: 8px;` anyway. `'padding' does not exist in type 'CssBlockShape'`.
- The check reports the same thing, in the same words.

This app writes `padding` in several blocks, so it will not compile. That is the edit working. Put
one back by name and watch that one alone return:

```ts
"*": { shorthand: false },
padding: { shorthand: true },
```

## 2. Limit how many values a property takes

```ts
"*": { arity: 1 },
```

**What should happen.** `padding: 8px` is fine and `padding: 8px 12px` is reported:

```
too-many-values: `padding` takes one value in this project, and this is 2.
```

Three things to check, because each was a fault before it was a test:

- `padding: calc(1rem + 2px)` is **silent** — a call is one value however many spaces are inside it.
- `border-left: 4px solid red` is **silent** — its parts are a width, a style and a colour, which is
  one value in three parts rather than three values. The sweep only reaches the sixteen properties
  that repeat one longhand.
- `margin: 0 auto` is **reported**. Centring is two values. This is the trap in the obvious strict
  default, and the reason `arity: 1` is not what a scaffolded config should contain.

`arity` is the one constraint the checker enforces rather than the types, and the reason is measured:
a type for it is a template literal over the permitted values, and at 49 units by four positions
TypeScript silently stops checking — no error, no message, anything accepted. A type that quietly
stops checking is worse than none.

## 3. Limit the units

### Project-wide, by family

```ts
units: { length: ["px", "rem"], percentage: ["%"] },
```

This one sits at the TOP level of the config, not inside `properties`, and the checker reads it —
so it reaches values no type describes: `transition`, `rotate`, `grid-template-columns`.

**What should happen.** `padding: 2em` is reported. `transition: all 200ms ease` and `rotate: 45deg`
are not — `time` and `angle` are families this config says nothing about, so it constrains neither.

**Why it is keyed by family.** It used to be a flat list, `units: ["px", "rem"]`, and that meant
*every unit in CSS and nothing else*. Measured, a project stating the one rule it wanted got four
reports on ordinary CSS: `200ms`, `50%`, `45deg`, `1fr`. To say "lengths are px and rem" you had to
enumerate the units of five families you had no opinion about. Try it — write the flat list, and the
config refuses to load with the family form written out for you.

An empty list bans a family outright: `units: { flex: [] }` says this project does not use `fr`.

### Per property, through the types


```ts
"*": { units: ["px", "rem", "%"] },
```

**What should happen.** `letter-spacing: 0.05em` is reported and `letter-spacing: 2px` is not. The
message names the type, which now holds only the three units this project permits.

Narrow one property instead of all of them:

```ts
"letter-spacing": { units: ["em"] },
```

Now `em` is the only unit it takes, and every other property is unchanged.

## 4. Take a whole kind from variables only

```ts
"<color>": { variablesOnly: true },
```

**What should happen.** `color: red` and `border: 1px solid red` are both reported. `$.color.accent.main`
is not, and neither is `currentcolor`, `inherit` or `var(--anything)` — none of those is a colour
somebody hardcoded.

`"<color>"` is a SELECTOR, not a property. `properties` is keyed by three things, each binding more
tightly than the one before:

```
"*"              every property
"<color>"        every property whose value is that kind
"border-radius"  that property
```

A colour reaches 40 properties and a length 127, which is why this is said by kind. The word
`<color>` is the same one already written in `kind("color", …)`.

Now exempt one:

```ts
"<length>": { variablesOnly: true },
"border-radius": { variablesOnly: false },
```

Every length comes from `$`, except `border-radius`. A bare `0` always goes in — a zero length needs
no unit in CSS and is not a value anybody hardcoded.

## 5. Limit the values outright


`z-index` already has this, and it is the shape most projects want first:

```ts
"z-index": { values: [0, 1, 10, 100, 1000] },
```

**What should happen.**

- `z-index: 5` is reported: `Type '"5"' is not assignable to type '0 | "0" | 1 | "1" | 10 | …'`.
- `z-index: 10` is fine.
- In the editor, type `z-index: 1` and look at the suggestions. **Only the permitted values are
  offered** — `auto`, `calc()` and the rest are gone. That half is worth checking on purpose: the
  types and the suggestions come from different places and could disagree without either being
  broken, and they did until it was measured.

Both spellings of a number work: the list is written `[0, 1, 10]` and a block is CSS, so the value
arrives as the text `"10"`. Writing the list the way you think about it is enough.

## 6. Add a variable and use it

In `variables`:

```ts
color: kind("color", {
  accent: { main: "#10b981", quiet: "#00b37e", loud: "#047857" },
  ...
}),
```

**What should happen.**

- `$.color.accent.loud` completes, one level at a time: `$.` offers the groups, `$.color.` offers
  the colours, and so on.
- It compiles to `var(--color-accent-loud)`, and codegen has written both the `:root` that sets it
  and the `@property` that registers it. Neither file is committed.
- `padding-left: $.color.accent.loud` is **reported**: a colour is not a length.
- `$.color.accent.lodu` is reported with *Did you mean* — twice, once by the type and once by the
  checker, which is deliberate: the type answers in the editor and the rule answers in CI.

## 7. What no config at all does

Rename `ramonda.css.ts` and run the check. Blocks still work; nothing is narrowed, `$` does not
exist, and a value typed `string` goes into any property. That is the honest state of a project that
has not written a config, and it is why `create-ramonda` scaffolds one.
