---
title: The config file
description: What ramonda.css.ts holds — the tokens a project declares, and the CSS it decides not to allow.
section: Style blocks
order: 116
---

# The config file

`ramonda.css.ts` sits at the root of a project and does two jobs. It **declares** what the project
owns — the tokens [`$` reads](/style-blocks/tokens) — and it **narrows** what a block may
say. Both reach every consumer: your editor, `ramonda-css`, and the build.

It is TypeScript rather than JSON because a setting may depend on the environment, and because you
get completion for the property names.

```ts
// ramonda.css.ts
import { kind } from "@ramonda/css/config";

export default {
  tokens: {
    $color: kind("color", { accent: "#10b981" }),
  },
  properties: {
    "<color>": { hardcoded: false },
  },
};
```

A project needs no config at all. Without one, every block is checked against CSS itself and
nothing more.

## What happens when it changes

Save it and the running dev server picks it up: `css-system/` is written again and every file
holding a block is checked against the new rules on its next request. In CI,
`ramonda-css codegen --check` fails if what is committed no longer matches the config beside it.

A config that does not parse is **refused**, rather than loaded as an empty one. That matters more
than it sounds: TypeScript recovers from a syntax error and hands back what it could build, so a
missing brace would otherwise mean every rule in the file silently switching off and the build
shipping without them.

## Narrowing: three selectors, in order

`properties` is keyed three ways, and each binds more tightly than the one before:

```ts alternatives
export default {
  properties: {
    "*": { shorthand: false }, // every property
    "<length>": { hardcoded: false }, // every property that takes a length
    "padding-left": { units: ["px"] }, // this one
  },
};
```

A `<kind>` is CSS's own classification — `<color>`, `<length>`, `<time>`, `<angle>` and the rest.
Naming a property directly wins over naming its kind, which wins over the sweep, so an exemption is
written where the exception is:

```ts alternatives
export default {
  properties: {
    "<length>": { hardcoded: false },
    "border-radius": { hardcoded: true }, // except here
  },
};
```

**Ask the tool rather than working it out.** `ramonda-css explain` reads the same answer the checker
uses, and says which selector decided each part:

```
$ npx ramonda-css explain padding-left

  padding-left   a length or a percentage

    shorthand      false        "*"
    hardcoded      false        "<length>"
    units          px           "padding-left"

  from ramonda.css.ts
```

## What a project can narrow

### `units` — which units may be written

At the top level it is keyed by **family**, and a family you do not name is not constrained:

```ts
units: { length: ["px", "rem"] },
```

That permits `16px` and `1.5rem`, refuses `2em`, and says nothing about `200ms` or `45deg` — those
are the `time` and `angle` families, and this config did not mention them. The families are `length`,
`percentage`, `angle`, `time`, `frequency`, `resolution` and `flex`; an empty list bans a family
outright.

Per property it is a plain list, because one property has one set of units and no family to
separate:

```ts
properties: { "padding-left": { units: ["px"] } },
```

### `hardcoded: false` — no values written out

```ts
properties: { "<color>": { hardcoded: false } },
```

`color: #ff0000` is then refused and `color: $color.accent` is not — a colour has to come from a
token. It is the setting that turns a palette from a recommendation into something the build
enforces. `hardcoded: true` on one property exempts it again.

Two things it deliberately lets through: a bare `0`, which needs no unit and is nobody's hardcoded
brand colour, and `var()`, which is the escape CSS itself provides.

### `values` — a closed list

```ts
properties: { "z-index": { values: [0, 1, 10] } },
```

Anything else is refused, in the editor and in the build. It belongs to one property or one kind;
on `"*"` it is refused, because a list of permitted values for every property is not a thing anybody
means.

### `shorthand` — switching a shorthand off

```ts
properties: {
  "*":       { shorthand: false },
  "padding": { shorthand: true },
}
```

Writing a shorthand that is off is reported as `shorthand-not-allowed`, and the message lists the
longhands to write instead. It is also **removed** from the property map, so your editor no longer
completes it.

### `arity` — how many values go in

```ts
properties: { "padding": { arity: 2 } },
```

`padding: 8px 12px` goes in and `padding: 8px 12px 16px 20px` does not.

## The other keys

### `externalCustomProperties` — names from a stylesheet this does not compile

A `var(--name)` is checked against every name the build sets. When the name comes from a stylesheet
the compiler never sees — a design system you install, a theme file — list it:

```ts
externalCustomProperties: ["--brand-hue", "--brand-chroma"],
```

### `unknownCustomProperties` — no names made up on the spot

```ts
unknownCustomProperties: false,
```

`--brand: red;` and `var(--brand)` are then refused in a block and in a `style` attribute — any name
that is not a token and not in `externalCustomProperties`. A name invented in one place and read in
another works by agreement, and a typo breaks the agreement in silence. With this off, every custom
property comes through a door that is checked:

- a design value is a **token** — `$color.accent`;
- a value from code is a **`@@property( … )`**, read as `var($(name))`;
- a name an outside stylesheet sets goes in **`externalCustomProperties`**.

Left out, any name is allowed, as in CSS. Stylesheets of your own are not checked for it.

### `outDir` — where `css-system/` goes

```ts
outDir: "src/css-system",
```

For a project that already has a folder by that name. It must stay inside the project, and it must
be a plain string: your editor reads this key out of the file's text rather than running it, so a
computed one is refused rather than quietly disagreeing with what the build wrote.

### `rules` — turning a report off

```ts
rules: { "unknown-unit": "off" },
```

Every rule is an error by default. A rule this config turned ON itself cannot be switched off here —
`units: { length: ["px"] }` and then `"unit-not-allowed": "off"` is refused, because the same
constraint also reaches the types and no rule severity can reach those. Change the setting instead.

## When a setting depends on the environment

The default export may be a function:

```ts
export default (env) => ({
  units: { length: env.production ? ["px"] : ["px", "rem"] },
});
```

`env.production` is what the bundler says it is: Vite passes its mode, esbuild reads `define`, then
`minify`, then `NODE_ENV`. It cannot be `async` — your editor asks for the config synchronously, so
there is nowhere to await it. Read what you need at the top level instead.

## Next

- **[Project settings](/style-blocks/settings)** — the names a block emits, and who they are for.
- **[What is checked](/style-blocks/checking)** — every rule, and what each one says.
