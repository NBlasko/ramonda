---
title: Performance
description: What is already free, the one class of mistake that costs you renders, the three declarations that fix it, and how to see which is happening.
section: Across the app
order: 117
---

# Performance

Most of what a performance page usually teaches does not apply here, and the reason is the
[reactivity model](/why/reactivity): a component re-renders when **its own** state changes, and
nothing else does. There is no tree-wide diff to opt out of, so there is nothing to wrap components
in by default.

Which leaves a much smaller subject: one class of mistake that costs renders, three declarations
that answer it, and two ways to see which is happening to you.

## What is already free

**A change re-renders one component, and patches only the DOM that differs.** Appending a row to a
table of ten rebuilds the page component and not the ten rows — `list()` keeps each row's scope and
its node, so the rows are never asked to render.

**A context consumer wakes per key.** Reading `theme` from a context whose `tick` moved does not
re-render you. See [context](/composition/context).

**A hook's props callback is fine-grained**, unlike a component's own state: it re-runs when
something it read changed, which is what lets a hook take a live value without its owner
re-rendering. See [where fine-grained tracking does live](/why/reactivity#where-fine-grained-tracking-does-live).

None of that needs asking for. If a commit rebuilds more than you expected, the cause is almost
always the next section.

## The one mistake that costs renders

**Every prop is a signal, and a signal compares by reference.** So a value built during the render
is a *changed* prop every time — and a changed prop recomputes every `@compute` reading it, fires
every `@watchProp` on it, and reconnects a subscription whose `connect` read it.

```tsx expect-report:fresh-object-in-props
<Row item={item} tags={[...item.tags]} />   {/* a new array every render */}
```

Nothing about that line looks expensive. The cost is downstream, and it is why the framework
reports it: [`RMD020`](/reference/diagnostics/rmd020) for a value `render()` produced differently
the second time, [`RMD022`](/reference/diagnostics/rmd022) for a hook's props callback doing the
same, and [`RMD024`](/reference/diagnostics/rmd024) for a `@compute` that recomputes without its
answer changing.

`ramonda-check` finds the same class before anything runs, and the ones that come up most are
[`fresh-object-in-props`](/rules/fresh-object-in-props),
[`function-built-in-the-markup`](/rules/function-built-in-the-markup),
[`arrow-fields`](/rules/arrow-fields),
[`ref-built-where-it-cannot-be-kept`](/rules/ref-built-where-it-cannot-be-kept) and
[`index-as-key`](/rules/index-as-key).

## The three declarations

Each says something different about a value, and picking the wrong one is why they are worth
distinguishing.

| | it says | reach for it when |
|---|---|---|
| [`@compute`](/reference/decorators/compute) | this value is derived, and is recomputed only when what it reads changes | the value is a function of state you already hold |
| [`@memoized`](/reference/decorators/memoized) | cache this by its arguments, per instance | the value has to be built per item — a handler for a row |
| [`@StableProps`](/reference/decorators/StableProps) | this prop is a VALUE, so compare its contents rather than its identity | the parent legitimately rebuilds it and you cannot change the parent |

A `key` is the fourth answer and the commonest one: a list whose rows are rebuilt objects keeps
every row's state and DOM only if the rows can be told apart. See [rendering lists](/lists).

**A context can make the same declaration at creation** — `createContext(value, { stableProps: [...] })`
— which is the right end when the keys are the context author's knowledge rather than a consumer's.

## Seeing which it is

**The devtools `PROFILE` tab**, and the count matters more than the milliseconds. A commit that says
`Row ×40` after one row changed is not a slow component; it is forty renders that did not need to
happen. Recording costs about 3.6% of a commit and nothing at all while stopped. See
[what a commit cost](/devtools#what-a-commit-cost).

**`ramonda-check --split`** answers the other question — what the browser downloads before it does
anything. It splits where a bundler splits, at a `lazy` prop and nowhere else, and reports the first
payload, each split point, and what several of them share. See
[what loads when](/reference/check#what-loads-when).

## What not to reach for

**Do not declare these pre-emptively.** `@compute` on a value nothing reads twice, `@memoized` on
something built once per component, `@StableProps` on a prop the parent already keeps stable — each
adds a comparison and buys nothing, and the checker reports the clearest case as
[`decorator-that-adds-nothing`](/rules/decorator-that-adds-nothing).

**A slow render is a different problem from too many renders**, and the profile tab tells them
apart: one commit taking a long time is work to move — off the render path, into a `@compute`, or
behind a [`lazy`](/composition/lazy) boundary. Forty commits taking no time each is the section
above.

**And the checks themselves cost nothing in production.** The double render behind `RMD020`, every
diagnostic, and the profiler are development-only and are not compiled into a production build.

## Next

- [The reactivity model](/why/reactivity) — why a component is the unit, and where the exception is.
- [Rendering lists](/lists) — identity, which is the single biggest lever here.
- [Devtools](/devtools#what-a-commit-cost) — the profile tab, and how to read a commit.
