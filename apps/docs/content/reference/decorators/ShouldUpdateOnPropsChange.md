---
title: ShouldUpdateOnPropsChange
description: The rule a component follows when its parent hands it new props — an escape hatch, with a cost worth reading first.
section: Reference
order: 132
---

# `@ShouldUpdateOnPropsChange`

A component re-renders when its parent hands it new props. `@ShouldUpdateOnPropsChange` puts you in
charge of that decision: return `true` to take the update, `false` to ignore it.

## The situation it is for

A table of a thousand rows. Each row is handed the record it draws and a `theme` object the parent
rebuilds on every render — a shape that turns up in real code more often than anyone admits:

```tsx expect-report:fresh-object-in-props
interface Row {
  id: number;
  label: string;
}

interface RowProps {
  row: Row;
  theme: { dense: boolean };
}

class RowView extends Component<RowProps> {
  render() {
    return <li>{this.props.row.label}</li>;
  }
}

class Table extends Component<{ rows: Row[] }> {
  @state hovered = 0;

  render() {
    return (
      <ul onmouseleave={this.clear}>
        {list(this.props.rows, (row) => (
          <RowView key={row.id} row={row} theme={{ dense: true }} />
        ))}
      </ul>
    );
  }

  clear() {
    this.hovered = 0;
  }
}
```

Move the mouse out of the table and `hovered` changes, so `Table` renders again — and
`theme={{ dense: true }}` is a **new object every time**. Every one of the thousand rows is handed a
changed prop, so every one of them renders, although nothing any of them draws has moved.

`ramonda-check` reports that literal as
[`fresh-object-in-props`](/rules/fresh-object-in-props), and the first thing to try is its advice:
[`@StableProps("theme")`](/reference/decorators/StableProps) on `RowView`, which compares the
contents and hands back the identity it already had.

Where that is not enough — the prop really does change, and the row still does not care —
`RowView` can refuse the update outright:

```tsx
interface RowProps {
  row: { id: number; label: string };
  theme: { dense: boolean };
}

@ShouldUpdateOnPropsChange((self, previous: RowProps, next: RowProps) => previous.row !== next.row)
class RowView extends Component<RowProps> {
  render() {
    return <li>{this.props.row.label}</li>;
  }
}
```

Now a row renders when *its record* changes and not when the table around it happened to render. The
predicate is handed the instance, the props it currently has, and the props it is being offered.

## Read this before reaching for it

**Refusing an update leaves the props stale for this component's own later renders too.** Nothing
re-reads them until the parent sends another update — so a re-render caused by this component's own
`@state` still shows the props it last *accepted*, not the ones it was last handed.

That is the trade, and it is why this is an escape hatch rather than an optimisation to sprinkle.
Reach for [`@StableProps`](/reference/decorators/StableProps) first: it names values instead of
writing a rule, so the worst a mistake can do is fail to type-check rather than freeze a component.

## Why a class decorator

It was a method decorator once, and moving it fixed two faults this shape cannot have:

- **A subclass overriding the decorated method** without re-decorating ran the *base's* body,
  because the function was captured at decoration time. There is no method to capture now.
- **Declaring it at both levels** — the ordinary way to override a rule — was reported as a
  duplicate, because nothing recorded which class had declared it. The answer lives on the
  constructor now, so "declared here" and "inherited" are told apart exactly.

## What it refuses

**Anything but a function.** It throws where it is written, naming what was passed.

## What it costs

Your predicate runs on every props update, and everything it does not compare is a change this
component will not see. That is the direction that hurts: a component which stops rendering when it
should is a bug that looks like nothing at all.

## Next

- [`@StableProps`](/reference/decorators/StableProps) — names instead of a rule, and the first thing
  to try.
- [Props](/concepts/props) — how an update reaches a component.
- [The reactivity model](/why/reactivity) — what re-renders, and why.
