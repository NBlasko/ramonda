---
title: Context
description: Publish a value to a subtree, read it anywhere below, without threading it through every level.
section: Composition
order: 71
---

# Context

```tsx
import { createContext } from "@ramonda/core";

const [ThemeProvider, ThemeConsumer] = createContext({
  theme: "light",
  accent: "pink",
});
```

`createContext` returns a **pair**: a provider hook and a consumer hook. Both are hooks, so
neither adds an element.

```tsx
class App extends Component {
  @state theme = "light";
  provider = this.use(ThemeProvider, (self: App) => ({ theme: self.theme, accent: "pink" }));
}

class Badge extends Component {
  ctx = this.use(ThemeConsumer);
  render() {
    return <span className={this.ctx.theme}>{this.ctx.accent}</span>;
  }
}
```

```demo:ThemeContextDemo
```

Nothing between `App` and `Badge` knows the theme exists.

## Reads are per key

`this.ctx.theme` subscribes to `theme`, not to the whole context. A component reading only
`theme` is not re-rendered when `accent` changes.

That is not an optimisation you opt into — it is how the context is built. Each key is its own
signal.

## The default is a real fallback

The object passed to `createContext` is used for any key a provider does not supply — not just
when there is no provider at all.

```tsx
createContext({ theme: "light", accent: "pink" });
// a provider passing only { theme } leaves accent as "pink"
```

An explicitly provided `undefined` still wins. The default is for keys nobody mentioned.

## No provider above

Reading a consumer with no provider anywhere above it falls back to the default and reports
`RMD003` in development, naming the context and the key.

It is reported on the **read**, not on construction, because a hook may legitimately hold a
consumer it never reads.

## Labelling it for devtools

```tsx
createContext({ theme: "light" }, { label: "Theme" });
```

The devtools tree then shows `ThemeProvider` / `ThemeConsumer` rather than anonymous nodes.
Development only.

## When not to use it

Context is for values a whole subtree needs and nothing in between should have to carry — theme,
locale, the current user, a router. For a value one child needs, pass a prop. Threading a prop
through two levels is clearer than a context nobody can see.

## Next

- [Children](/composition/children) — passing markup down.
