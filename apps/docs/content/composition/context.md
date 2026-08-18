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

Three things follow from how that works, and none of them is guessable:

**The tie is made once and lasts until the component goes.** The first read of a key
subscribes to it; a later render that does not read it does not unsubscribe. So a
component that read `theme.accent` down a branch it no longer takes still re-renders
when `accent` changes — the render finds nothing different and the DOM is untouched,
but the work happens. It is not the render-tracked model, where not reading is not
subscribing.

**A key is compared, not explored.** Change `theme.accent` and consumers of `accent`
wake up; change something *inside* the value a key holds — `config.limits.max = 5` —
and nobody hears it, exactly as with [state](/concepts/state). Replace the value:

```tsx
this.limits = { ...this.limits, max: 5 };   // ✓ the key changed
```

If part of a value changes on its own schedule, give it its own key, or derive it with
a [`@compute`](/concepts/compute).

**A consumer looks for its provider once, when it is created.** A provider that mounts
*above* an existing consumer afterwards is not picked up — the consumer already
answered the question of where its values come from. Mount the provider above the
subtree from the start; if the value is what changes, change the value.

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

That matters for the case that would otherwise ship silently: a panel behind a condition nobody has
clicked yet reads nothing, so a read-time check would never speak — and the page renders with the
default filled in, looking fine.

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

## When two of them conflict

Nesting is ordinary: a second Provider below the first shadows it, and the nearer one wins. That is
how a theme override inside a panel works, and a form inside a form.

For some contexts a second one is not a narrower scope but a **conflict**. Say so once, where the
context is created:

```tsx
const [RouteProvider, RouteConsumer] = createContext(
  { path: "/" },
  { label: "Route", single: true },
);
```

The router's is the case: two Routers both listen to `popstate` and both write history, and the
first to unmount takes the listener the survivor depends on. Mounting a second one throws — and
[`ramonda-check`](/reference/check) reports it before anything renders, on every path your source
can produce, including the branch nobody clicked.

Like `label` and `optional`, this is a declaration rather than behaviour: it changes what is
reported, never what is read.

## The order of your use() calls matters

A consumer resolves its provider once, when it is constructed — so inside **one** class, the
provider has to come first:

```tsx
class Panel extends Component {
  theme = this.use(ThemeProvider, () => ({ theme: "dark" })); // ✓ first
  ctx = this.use(ThemeConsumer);
}
```

Reversed, the consumer is constructed before the provider has published, and what it reads for the
rest of its life depends on what is ABOVE this component. With no provider on any ancestor it reads
the context's default and says so with
[`RMD003`](/reference/diagnostics#rmd003-context-consumed-without-a-provider-above-it). With one, it
reads that ancestor's value — quietly, and correctly as far as anything can tell, which is why
[`RMD057`](/reference/diagnostics#rmd057-a-context-consumed-above-the-provider-on-the-same-component)
exists: moving one of the two lines past the other changes the answer, and nothing else would say so.

Reading it through the **provider** avoids the question altogether. A provider reads as well as
publishes, so `this.theme.theme` is always this component's own value however the fields are ordered —
and a consumer beside a provider on the same class is a second way of asking what the provider already
answers.

If the value from above is what you want — an outer theme you derive an inner one from — then the
reversed order is the one that arrangement needs, and the report is telling you which of the two you
have rather than that you are wrong.

Between components there is nothing to think about: an ancestor is always constructed before its
descendants.

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
