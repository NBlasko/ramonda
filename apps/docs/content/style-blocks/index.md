---
title: Style blocks
description: Real CSS beside your markup, compiled before the build into atomic classes and a stylesheet, and checked as CSS while you type.
section: Style blocks
order: 106
---

# Style blocks

`@ramonda/css` lets you write real CSS beside the element it styles, in a `@@( … )` block, and
compiles it before your build into classes and a stylesheet. Here is one, and what the build makes
of it — open the other two tabs:

```tsx compiled
<div className={@@(
  display: flex;
  gap: 8px;
  border-left: 4px solid #10b981;
  &:hover { border-left-color: #00b37e; }
)}>
  Online
</div>
```

**What you wrote there is not a string, an object or a template literal** — it is CSS, and it is
checked as CSS: a misspelled property, a value the property does not take, and a unit your project
does not use are all reported where you wrote them, before the build runs.

It compiles away. Each declaration becomes a class in a stylesheet — a shorthand like `gap` becomes
one per longhand it sets — and the CSS is a file the browser caches. What reaches the element is a
string of classes, which is why a block goes on `className`. No CSS is generated in the browser:
what runs there is a small merge that puts class strings together.

## What you get

- **CSS that is checked as CSS** — in your editor while you type, and again by the build, with the
  near miss offered: `dsiplay` is `display`.
- **One class per declaration**, so two files that write `display: flex` share one rule, and the
  stylesheet grows with the declarations you use rather than with the components.
- **Composition that follows CSS** — spread one block into another and the later declaration wins,
  shorthands and conditions included.
- **A project's own rules**, in one config file: the units it uses, the values a property may take,
  and the colours that must come from its tokens.

**What it needs:** TypeScript, a Vite or esbuild build, and — for the checks while you type — your
editor's TypeScript service. Next page.

`@ramonda/css` is a **separate package**. The framework's own position on styling — a `className`, a
`style`, stylesheets the way they have always arrived — is on [Styling](/styling), and it does not
change if you never install this.

## Next

- **[Setting up](/style-blocks/setup)** — install it, add one plugin to your build, turn on the
  editor plugin, and check that it worked.
- **[Writing a block](/style-blocks/writing)** — where a block goes, nesting, and where a value that
  changes goes instead.
- **[Values that come from data](/style-blocks/dynamic)** — declaring a property, reading it, and
  setting it on an element.
- **[What is checked](/style-blocks/checking)** — every rule, what it catches, and how to silence one
  that is wrong.
- **[Names the stylesheet sees](/style-blocks/tokens)** — declaring tokens and reading them
  with `$`, keyframes and font faces, and what a theme is.
- **[Which declaration wins](/style-blocks/order)** — two declarations of one property, and the rule
  that decides between them.
- **[Shorthands](/style-blocks/shorthands)** — what a shorthand becomes, and the few that stay
  whole.
- **[Composing](/style-blocks/composing)** — reusing a block, conditions, and your own stylesheet.
- **[The config file](/style-blocks/config)** — `ramonda.css.ts` end to end, and what a project can
  decide not to allow.
- **[Project settings](/style-blocks/settings)** — the names a block emits, and who reads them.
- **[In the browser](/style-blocks/browser)** — from an element or a rule back to the line that
  wrote it.
- **[Tooling](/style-blocks/tooling)** — formatters, linters, other JSX libraries, and what this
  does not do.
