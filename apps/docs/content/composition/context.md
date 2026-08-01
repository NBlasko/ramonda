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

## Declare what a component needs

A consumer is reported only when something **reads** it, and that is deliberate: holding a consumer
you read down one branch is not a mistake. But it leaves a component that mounts and reads nothing
— yet — silent.

If a component genuinely cannot work without a context, say so:

```tsx
import { requiresContext } from "@ramonda/core";

@requiresContext(ThemeConsumer)
@Host("section")
class Panel extends Component { … }
```

Now the check happens when the component **mounts**, before anything reads a value. A panel that
finally appears — a lazily-loaded chunk, a condition that turned true — reports the first time it
shows up instead of waiting for the read. A subclass adds to what its parent declared.

It is development-only: in a production build the declaration is inert.

Even this only speaks for components that actually mount. To be told about a branch nobody has
opened, run [`ramonda-check-context`](/reference/check) — it proves the same thing from the source,
before the app starts.

## When not to use it

Context is for values a whole subtree needs and nothing in between should have to
carry — theme, language, the current user, the router. For a value just one child
needs, pass a prop; threading a prop through a level or two is clearer than a value
that is invisible in the markup.

## Next

- [Children](/composition/children) — passing markup down.
