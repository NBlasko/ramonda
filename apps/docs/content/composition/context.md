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

## An object as a value, and the callback that builds it

A key holding an object literal is a **new object every time the callback runs**, and a new object
is a changed key — so every consumer of it wakes, however far down the tree it sits and however
unchanged the contents are. A consumer reading only `conf`, while `tick` moves three times:

```tsx
class App extends Component {
  @state tick = 0;
  provider = this.use(ThemeProvider, (self: App) => ({ conf: { dense: true }, tick: self.tick }));
}
```

Four renders where one was enough. Say which keys are **values** rather than identities, and the
framework hands back the same object for as long as the contents match:

```tsx
const [ThemeProvider, ThemeConsumer] = createContext(
  { conf: { dense: false }, tick: 0 },
  { stableProps: ["conf"] },
);
```

One render. The callback still writes the plain literal, and no consumer wakes for it. Contents
that really move still arrive — this is a comparison, not a freeze.

The declaration belongs at the context rather than at the call site because whether `conf` is a
value or an identity is the context's own knowledge, and it is true for every provider of it. Names
are checked against the keys of the default value, so a typo is refused rather than ignored.

Functions are the exception: two functions with the same body are never equal by any comparison
that is safe to make, so a listed function key is left exactly as it came. Pass a bound method
instead.

**A callback that reads nothing is called once.** It is cached on the signals it read, so one that
reads no state, no `@compute`, no prop and no other hook runs at mount and never again — and a
literal inside it keeps one identity for the life of the component. That is the shape to reach for
when the value never changes, and it needs no declaration at all:

```tsx
class Root extends Component {
  provider = this.use(ThemeProvider, () => ({ conf: { dense: true } }));
}
```

`ramonda-check` reports the first shape and stays quiet about the last one, as
`fresh-object-in-hook-props`.

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
[`RMD003`](/reference/diagnostics/rmd003). With one, it
reads that ancestor's value — quietly, and correctly as far as anything can tell, which is why
[`RMD057`](/reference/diagnostics/rmd057)
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

## Two of one context: a scope per subtree

One component publishes a context **once**. A second Provider of the same context on the same
component throws
([`RMD056`](/reference/diagnostics/rmd056)), and not
as a matter of taste: a component has one context object, so the second would replace the first and
hand every descendant the second whichever part of the tree it is in — while the component itself
could still read both through its own hooks. The one place that made the mistake is the one place it
looks fine.

So when you want two, give each one its own component and hand it the subtree it is for. A component
that renders `this.props.children` scopes its context to what is inside it:

```tsx
class Scope extends Component<{ theme: string; children?: RamondaNode }> {
  provider = this.use(ThemeProvider, () => ({ theme: this.props.theme, accent: "pink" }));
  render() {
    return this.props.children;
  }
}

class Page extends Component {
  render() {
    return (
      <div>
        <Scope theme="light">
          <Badge />
        </Scope>
        <Scope theme="dark">
          <Badge />
        </Scope>
      </div>
    );
  }
}
```

Both `Badge`es use a plain `this.use(ThemeConsumer)` and each reads its own scope, with nothing passed
down.

**Why it works is worth knowing**, because it is not obvious from the JSX. A context object is created
from the component that **renders** a node, not from the one whose source contains it — so a child
handed in as `children` inherits the wrapper's context. `<Badge />` is written inside `Page`, and it
reads `Scope`'s value.

**Nesting needs none of this.** A Provider on a descendant shadows the one above it for its own
branch, which is the ordinary arrangement — a theme override inside a panel, a form inside a form.
Only two on the *same* component are refused.

## Being told before you run the app

Mounting is enough to be checked, but a component that never mounts is never checked. To be told
about a branch nobody has opened, run [`ramonda-check-context`](/reference/check) — it proves the
same thing from the source, before the app starts, and it honours `optional` the same way.

## `createContext`'s second argument — `ContextOptions`

Four options, and each is explained where it matters above. Together, so the shape can be read in
one place:

| | |
|---|---|
| `label` | The name the devtools show instead of `Provider` / `Consumer`. Cosmetic, and stripped from a production build. |
| `optional` | Whether the default is a real answer rather than a stand-in. Default `false`, so a consumer with no provider above it is [reported](#no-provider-above-it). Set it where "nobody provided this" is a legitimate arrangement. |
| `single` | Whether a second one on the same path is a fault rather than [an override](#when-two-of-them-conflict). Default `false`: nesting is ordinary, and the nearest provider wins. |
| `stableProps` | Names the keys that are **values** rather than references, so a consumer of one is not woken by a literal that was merely [rebuilt](#an-object-as-a-value-and-the-callback-that-builds-it). |

**Three of them change what is REPORTED; one changes what is read.** `label`, `optional` and
`single` are declarations for the development checks and are stripped from production.
`stableProps` is behaviour — it changes the identity a consumer is handed, in every build.

The decision belongs here rather than at the consumer for all four: the context's author is the one
who knows what the default means and which keys are values. `stableProps` also has to be here
because this end knows the context's keys — a name that is not one of the default value's is
refused, which a declaration on a class could not see.

## When not to use it

Context is for values a whole subtree needs and nothing in between should have to
carry — theme, language, the current user, the router. For a value just one child
needs, pass a prop; threading a prop through a level or two is clearer than a value
that is invisible in the markup.

## Next

- [Children](/composition/children) — passing markup down.
