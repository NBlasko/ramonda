---
title: Styling
description: className and the two forms of style, what the framework converts for you, and the parts of styling it deliberately leaves to CSS.
section: Across the app
order: 118
---

# Styling

Ramonda has no styling system, and that is the whole of its position: an element takes a
`className` and a `style`, stylesheets arrive the way they always have, and everything else is
CSS's job.

What is worth knowing is the small amount the framework does convert — because in both cases the
alternative failed silently.

## `className`, not `class`

```tsx
<span className="muted">Draft</span>
```

**This is the one place the JSX deliberately differs from HTML**, and the reason is the language:
`class` is a reserved word in the object a JSX factory receives.

A `class` you write anyway is **renamed** before the element is built, so it is styled and
the page is not broken. It is still reported — [`RMD039`](/reference/diagnostics/rmd039) at runtime
and [`class-instead-of-classname`](/rules/class-instead-of-classname) before it — because the source
should say what the element gets, and because the rename cannot save two cases:

- **`className` on the same element wins**, and the `class` beside it is dropped without a word.
- **A component is renamed too.** `<Panel class="muted" />` reaches `Panel` as `className`, so a
  `class` prop that component declared reads `undefined` on every render.

On an SVG element the class is written as an attribute rather than a property, because there
`className` is a read-only `SVGAnimatedString` and assigning to it would take the render down. You
write the same thing either way.

## `style` takes a string or an object

```tsx
<div style="color: blue" />
<div style={{ color: "blue", backgroundColor: "red" }} />
```

**The object's keys are camelCase and are converted to the dashed form CSS parses**, which is the
conversion worth knowing about. Without it the browser drops what it cannot read, one declaration at
a time and silently: `{ backgroundColor: "red", color: "blue" }` measured as `style="color: blue;"`
— half the style gone and nothing said so.

**A custom property is passed through unchanged**, because `--brandColor` is already in its final form
and CSS treats it as case-sensitive — unlike every other property here:

```tsx
<div style={{ "--brandColor": "hotpink", color: "var(--brandColor)" }} />
```

A value of `undefined`, `null` or `""` drops that declaration rather than emitting `key:;`, which
some engines answer by discarding the whole rule. That is how you write a conditional declaration
without building two objects.

**An object built in the markup is a new value every render**, like any other — see
[performance](/performance). A style that does not change belongs in a stylesheet or a
[`@compute`](/reference/decorators/compute); `style` is for the values that do, a width from a
measurement, a transform from a drag.

## Where stylesheets come from

**In a client-rendered app**, however your bundler wants them — an `import "./app.css"` that Vite
turns into a link, or a `<link>` in your `index.html`. Nothing here is involved.

**In a server-rendered one**, the document shell links them: `renderDocument`'s `styles` option
takes the hrefs, or you place them yourself if you write the shell by hand. See
[static builds](/ssr/static#renderdocument-and-documentoptions) and
[`fillDocument`](/ssr/server#filldocument-document-the-document-it-takes).

## What the framework does not do

**No scoping, and no generated class names.** A `className` is the string you wrote, so the class
in your source is the class in the served HTML — which is what makes a stylesheet, a browser
inspector and a CSS module all work without the framework knowing about them. A generated class is
what [style blocks](/style-blocks) add, and they are a separate package you opt into rather than
something the framework does to your markup.

**No CSS-in-JS.** There is no way to write a style as JavaScript here, and that is a choice rather
than something missing: a style built in JavaScript ships inside the bundle, is rebuilt on every
render, and cannot be cached by the browser as a file of its own. [Style blocks](/style-blocks) are
not the exception they look like — a block is real CSS, compiled away before the bundle, and what
ships is a stylesheet the browser caches like any other.

**No theme system.** A theme is a context and some custom properties — publish the values with
[`createContext`](/composition/context), or set `--` properties high up and let CSS cascade them,
which needs nothing from the framework at all.

## Next

- [Style blocks](/style-blocks) — real CSS beside the markup, compiled to a class before the build.
- [JSX](/concepts/jsx) — the rest of the attribute surface, and how a name reaches the DOM.
- [Performance](/performance) — why an object built in the markup costs more than it looks.
- [Static builds](/ssr/static) — the document shell, and where your stylesheet links go.
