---
title: Classes and decorators
description: Why a component is a class, and why its lifecycle and state are decorators.
section: Why Ramonda
order: 122
---

# Classes and decorators

## Why a class

A component keeps three things together: the data it remembers, the code that changes
that data, and the code that draws it. A class is a natural home for all three — they
share one `this`, so they can reach each other without being passed around, and the
component has a real identity that survives re-renders. State is just a field; there
is no separate place for it to live and no rules about when you may read it.

It also makes reuse first-class. Because a component is a class, one component can
*extend* another — keep what it had, change what differs — which is where a lot of the
framework's composition story comes from.

## Why decorators, not reserved method names

Lifecycle and state are decorators — `@state`, `@created`, `@mounted`, `@updated` — rather
than special method names you are expected to implement.

The reason is collisions. If "the method named `mount` runs on mount", then `mount` is
a name you can never use for anything else, on any component, ever — and nothing warns
you when you shadow it by accident. A decorator attaches the behaviour without claiming
the name: `@mounted ready()` runs on mount, and `ready` is still just a method you named.
(`render` is the one exception — it is abstract, so the compiler forces exactly one and
the collision can't happen.)

## Why your methods are already bound

`onclick={this.increment}` works — you don't write a constructor or an arrow-field to
keep `this`. Ramonda binds your methods to the instance when the component is built.

That is not only convenience: a decorator can't be applied to an arrow-function field,
so if the way to keep `this` were an arrow field, you couldn't decorate your handlers.
Binding ordinary methods is what keeps `@memoizedHandler` and the event decorators
usable on them.

## Why TC39 decorators

Ramonda uses the standard (TC39 stage-3) decorators — the ones on their way into
JavaScript itself — not the older experimental TypeScript ones. That is why
[installation](/guide/installation) asks your bundler to transpile them: they are new
enough that not every runtime parses them yet, but they are the version with a future.
