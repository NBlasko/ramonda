---
title: Ramonda
description: A class-based frontend framework — signals, decorators, and one tag per element.
section:
order: 0
---

# Ramonda

A frontend framework built on classes, signals and decorators. State is a field on an
instance. Lifecycle is a decorated method. Every JSX tag is exactly one element.

```demo:Counter
```

## What is different

**One tag, one element.** There are no fragments and no function components. A JSX tree and
the DOM it produces have the same shape, so you can read one off the other. Anything that
would break that — a tag that is not an element — is refused rather than accommodated.

**State is a field.** `@state count = 0` turns a class field into a signal. Reading it inside
`render()` subscribes; writing it schedules a re-render. There is no setter to call and no
dependency array to keep honest.

**Methods are bound for you.** `onClick={this.increment}` works. No constructor, no arrow
fields, and decorators still apply because the methods are ordinary methods.

**The framework explains itself.** Fifteen development-only diagnostics catch the mistakes
that would otherwise be silent — state written during a render, props mutated, a list whose
items cannot be told apart, a component that updated after being unmounted. Each one names the
component and says what to do instead.

## Where to go next

Start with [Installation](/guide/installation) — it is short, and the three things it asks you
to configure are the three things that fail confusingly when they are missing. Then
[your first component](/guide/first-component).

If you would rather read than set up, [Components](/concepts/components) is the page that
explains the rest, and [Examples](/guide/examples) is every feature as a running component with
its source.
