---
title: Context
description: Share a value down a whole subtree without passing it through every component in between.
section: Composition
order: 51
---

# Context

Some values are needed all over the place — the current theme, the logged-in user,
the app's language. Passing such a value down as a prop through every component in
between is tedious. **Context** lets one component publish a value and any component
below it read it directly, with nothing in between having to carry it.

```tsx
import { createContext } from "@ramonda/core";

const [ThemeProvider, ThemeConsumer] = createContext({
  theme: "light",
  accent: "pink",
});
```

`createContext` gives you a pair: a **provider** to publish the value, and a
**consumer** to read it. Both are hooks, so neither adds an element to the page.

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

Nothing between `App` and `Badge` has to know the theme exists.

## You react to the keys you read

Reading `this.ctx.theme` ties this component to `theme`: change the theme and it
re-renders, but change only `accent` and it doesn't. Each key is tracked on its own,
and you get that for free.

## The default is a real fallback

The object you pass to `createContext` fills in any key a provider doesn't supply —
not only the case where there is no provider at all.

```tsx
createContext({ theme: "light", accent: "pink" });
// a provider passing only { theme } still leaves accent as "pink"
```

## No provider above it

If a consumer has no provider anywhere above it, it falls back to the default and, in
development, reports `RMD003` — naming the context and the key, so you can see what is
missing.

## When not to use it

Context is for values a whole subtree needs and nothing in between should have to
carry — theme, language, the current user, the router. For a value just one child
needs, pass a prop; threading a prop through a level or two is clearer than a value
that is invisible in the markup.

## Next

- [Children](/composition/children) — passing markup down.
