---
title: JSX
description: How Ramonda's JSX works — h, children, arrays, keys, and what is deliberately missing.
section: Core concepts
order: 31
---

# JSX

Ramonda's JSX compiles to `h(...)`, not `React.createElement`. Your bundler has to be told —
see [installation](/guide/installation).

```tsx
<p className="lead">Hello {name}</p>
// becomes
h("p", { className: "lead" }, "Hello ", name)
```

## Attributes are DOM attributes

Names are the DOM's, not a framework's rename. `className`, `htmlFor`, `tabIndex` — the
property names the DOM uses.

**SVG is the exception worth reading twice.** Ramonda writes SVG attribute names **verbatim**,
because the JSX is meant to be the DOM. So it is `stroke-width` — the SVG spelling — not a
camelCased `strokeWidth`, and `viewBox` stays camelCase because that is what SVG defines.

```tsx
<svg viewBox="0 0 24 24">
  <path d="…" stroke-width="2" />
</svg>
```

The camelCased spelling is rejected by the types. If it reaches the runtime it silently does
nothing — SVG attribute names are case-sensitive.

## Children

Text, elements, components, arrays, and `null` for nothing.

```tsx
<ul>
  {items.map((item) => (
    <li>{item.name}</li>
  ))}
</ul>
```

**An array stays one child.** Ramonda does not splice a nested array into its parent's children
the way a flatten would; it keeps it as its own group with its own key space. That is what lets
two `.map()` calls sit side by side without their keys colliding, and what stops a list's
siblings being mistaken for list items.

## `render()` may return an array

A component is one element — its host — and an array becomes that host's children.

```tsx
@Host("tr")
export class Row extends Component {
  render() {
    return [<td>{this.props.name}</td>, <td>{this.props.score}</td>];
  }
}
```

That is the answer to "one `<tr>` with many `<td>`s, without a component per cell".

## Keys

A `key` tells the diff that two elements across two renders are the same thing. It matters when
a list reorders, and it is the one place where a mistake is silent — the wrong key moves state
to the wrong row.

Which is why, for lists, **you should not be writing keys at all.** `list()` derives identity
from the items themselves:

```tsx
render() { return list({ each: this.rows, as: Row }); }
```

See [rendering lists](/lists). `key` remains available as an override for the case a list cannot
see — objects re-created by a refetch that mean the same entity.

## `ref`

On an intrinsic tag, `ref` receives that element. On a component, it receives the component's
host element — unambiguous, because a component is exactly one element.

```demo:RefFocus
```

## What is deliberately missing

**`JSX.ElementType` is not declared.** Its absence is what makes TypeScript apply its default
rule — a component used as a tag must return `JSX.Element` — which is exactly the rule Ramonda
wants, and it is what rejects a function in tag position. The absence is the feature.

**There is no `dangerouslySetInnerHTML`.** Markup injected as a string is invisible to the diff:
it cannot be hydrated, cannot contain a component, and cannot take part in a render. If you have
HTML from elsewhere, parse it into a tree and render that — which is what this documentation
site does with its markdown.

## Next

- [State](/concepts/state) — what a render reads, and what that subscribes to.
