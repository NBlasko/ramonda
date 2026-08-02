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
development, reports `RMD003` — naming the component and the context, so you can see what is
missing and where the provider has to go:

```
[RMD003] Context consumed without a provider above it
<Panel /> mounts ThemeConsumer with no Provider on any ancestor, so every key it reads
gets the default below.
```

The report happens when the component **mounts** — not when a value is first read. You write
nothing to get it: `this.use(ThemeConsumer)` already says which context this component needs, and
the consumer looks its provider up once, at that moment. So the answer exists at mount.

That matters for the case that used to ship silently: a panel behind a condition nobody has clicked
yet reads nothing, so a read-time check would never speak — and the page renders with the default
filled in, looking fine.

It is development-only: a production build reports nothing and reads exactly the same values.

## When the default is a real answer

Sometimes "nobody provided this" is a legitimate arrangement, and the default describes it rather
than standing in for something missing. Say so once, where the context is created:

```tsx
const [ParamsProvider, ParamsConsumer] = createContext(
  { params: {} },
  { label: "RouteParams", optional: true },
);
```

Now a consumer with no provider above it is silent. This is the router's own case: `params` belongs
to the route a `<RouteOutlet>` matched, so a nav bar **beside** the outlet correctly has none.

The flag belongs to the context, not to each consumer, because whoever wrote `createContext` is the
one who knows what the default means. Every consumer then behaves consistently, and nobody has to
remember to repeat it.

## The order of your use() calls matters

A consumer resolves its provider once, when it is constructed — so inside **one** class, the
provider has to come first:

```tsx
class Panel extends Component {
  theme = this.use(ThemeProvider, () => ({ theme: "dark" })); // ✓ first
  ctx = this.use(ThemeConsumer);
}
```

Reversed, the consumer is constructed before the provider has published, reads the default forever,
and says so with `RMD003`. Between components there is nothing to think about: an ancestor is always
constructed before its descendants.

## Being told before you run the app

Mounting is enough to be checked, but a component that never mounts is never checked. To be told
about a branch nobody has opened, run [`ramonda-check-context`](/reference/check) — it proves the
same thing from the source, before the app starts, and it honours `optional` the same way.

## When not to use it

Context is for values a whole subtree needs and nothing in between should have to
carry — theme, language, the current user, the router. For a value just one child
needs, pass a prop; threading a prop through a level or two is clearer than a value
that is invisible in the markup.

## Next

- [Children](/composition/children) — passing markup down.
