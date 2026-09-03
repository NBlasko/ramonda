---
title: Ramonda
description: A framework for building web interfaces — start here, even if it's your first one.
section:
order: 0
---

# Ramonda

Ramonda is a tool for building the parts of a web page people look at and interact
with — the buttons, forms, lists and text that change as the page is used.

You build the page out of small, self-contained pieces called **components**. Each
one knows how to draw a bit of the screen and how to react when something changes.
When your data changes, Ramonda updates the screen for you. You never reach in and
update the page by hand.

Never built for the web before? Good — this guide starts from zero and assumes
nothing.

```demo:Counter
```

That button is a live Ramonda component. It remembers a number, and each click adds
one. Notice what you did *not* have to do: there is no code that finds the button
and rewrites its text. You change the number, and the screen follows.

## The ideas, in a minute

You will meet these properly over the next few pages. Here is the shape of them, so
the words are familiar when they arrive.

**A component is a piece of the page.** It is a small class you write. It has a
`render()` that says what to draw, and it can hold data and respond to clicks. You
build a whole app by putting components together.

**State is what a component remembers.** A number, a name, whether a menu is open.
You mark a field with `@state`, change it like an ordinary variable, and Ramonda
updates the page to match. There is nothing else to call.

**What you write is what you get.** You describe the screen with a syntax called
JSX — it looks like HTML living inside your code. Each tag becomes exactly one thing
on the page, so the shape of what you write is the shape of what appears.

**The framework tells you when something is off.** While you develop, Ramonda
watches for the common mistakes — changing data at the wrong moment, a list it can't
tell apart — and prints a plain-language note naming the component and what to do
instead. In the finished app, those checks are gone and add nothing.

Already stuck on one? **[Something is wrong](/symptoms)** is the list of what you can
see — a row with the wrong text, a click nobody answers — and where each one comes from.

## Start here

1. **[Installation](/guide/installation)** — get a project running. It is short.
2. **[Your first component](/guide/first-component)** — write one from scratch,
   give it state, and handle a click.

Prefer to browse? **[Examples](/examples)** is every feature as a running
component you can read the source of.
