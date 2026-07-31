---
title: Subscriptions
description: Reach outside the component — a store, a socket, an observer — and clean up when it goes.
section: Lifecycle and subscriptions
order: 31
---

# Subscriptions

Some code has to reach outside your component: subscribe to a store, open a socket,
observe an element. It needs three things — to run once the component is on the page, to
be torn down when the component goes, and to be redone if what it subscribed *to*
changes.

That shape has one name here. You declare a decorator once, saying how to connect, and
what it returns is the cleanup:

```tsx
import { createSubscriptionDecorator } from "@ramonda/core";

export const onStore = createSubscriptionDecorator(
  "onStore",
  (_owner, handler: (state: ThemeState) => void, store: ThemeStore) => store.subscribe(handler),
);
```

```tsx
export class Panel extends Component {
  @state theme = "light";

  @onStore(themeStore)
  themeChanged(next: ThemeState) {
    this.theme = next.theme;
  }
}
```

`connect` runs after the DOM is committed. Whatever it returns is called before it runs
again, and once more when the component is destroyed — so a connection opened here is
always closed. Full detail, including how to demand something of the class it goes on, is
in [writing your own decorators](/hooks/own-decorators).

**It re-runs when a signal it READ changes.** Read `owner.channel` inside `connect` and
switching channels disconnects the old one before opening the new — which is the whole
reason this is not just "subscribe in `@mount`, unsubscribe in `@destroy`".

```demo:EffectCleanup
```

## The built-in ones

Several decorators are this same machinery with the connect already written, which is why
none of them need a cleanup from you:

| | |
|---|---|
| [`@onElement`](/concepts/events) / `@onWindow` / `@onDocument` | a DOM listener, removed on destroy |
| [`@interval`](/concepts/timers) / `@timeout` | a timer, cleared on destroy |
| [`@deferHydration`](/ssr/hydration) | waits for a promise before hydrating |

## Not everything outside is a subscription

Three other things get asked of an effect in other frameworks, and each has its own name
here — which is the point, because the name says when it runs:

**After the render, every time** — measuring an element, scrolling something into view:
[`@updated`](/concepts/lifecycle). It runs once the commit is done, so the DOM is the one
you are looking at.

**When a prop changes** — refetching for a new `id`, resetting a form:
[`@watchProp`](/concepts/props). It runs *before* the render, so what it derives is on
screen in the same pass rather than one frame later.

**Deriving a value** — [`@compute`](/concepts/compute). If the answer is a value, return
it; nothing needs to run and nothing needs to be cleaned up.

## There is no `@effect`

Nothing here corresponds to `useEffect`, and that is the design. An effect is defined by its
dependencies rather than by its purpose, so one decorator would have to be all four of the
things above — and which one it was would depend on what its body happened to read that
render. Two of them writing what the other reads then re-trigger each other, which is the one
way to hang a page that no diagnostic can explain in a sentence.

Naming the purpose instead means the framework knows when to run each thing, in what order,
and what to say when it goes wrong. Reaching for an effect? The name is on the left:

| what you want | here |
| --- | --- |
| subscribe to something outside, clean up on unmount | [your own decorator](/hooks/own-decorators) |
| read or correct the DOM after it changed | [`@updated`](/concepts/lifecycle) |
| react to a prop changing | [`@watchProp`](/concepts/props) |
| derive a value from other values | [`@compute`](/concepts/compute) |
| fetch data for a key | [`@ramonda/query`](/query) |

## Next

- [Your own decorators](/hooks/own-decorators) — the full contract, and typing the owner.
- [Timers](/concepts/timers) — `@interval` and `@timeout`, built on this.
