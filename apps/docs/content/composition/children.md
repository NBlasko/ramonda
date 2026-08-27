---
title: Children
description: Let a component wrap whatever markup it is given.
section: Composition
order: 52
---

# Children

The content you put *inside* a component's tags is handed to it as a prop called
`children`. That lets you write a component that wraps whatever it is given.

```tsx
export class Panel extends Component<{ title: string; children?: RamondaNode }> {
  render() {
    return (
      <section className="panel">
        <h2>{this.props.title}</h2>
        {this.props.children}
      </section>
    );
  }
}
```

```tsx
<Panel title="Settings">
  <p>Anything at all.</p>
</Panel>
```

`Panel` draws its own frame and drops whatever it was given where
`{this.props.children}` sits.

## More than one slot

There is no special "slot" syntax — if you need to place content in more than one
spot, take more than one prop. Markup is just a value, so you can pass it like any
other:

```tsx
export class Dialog extends Component<{
  header: RamondaNode;
  children?: RamondaNode;
  footer?: RamondaNode;
}> {
  render() {
    return (
      <div className="dialog">
        <header>{this.props.header}</header>
        <div className="body">{this.props.children}</div>
        {this.props.footer ? <footer>{this.props.footer}</footer> : null}
      </div>
    );
  }
}
```

```tsx
<Dialog header={<h2>Confirm</h2>} footer={<button>OK</button>}>
  <p>Are you sure?</p>
</Dialog>
```

## A slot belongs where it lands

Markup you pass through a prop is *placed* by the component that receives it, and that is the
component it belongs to: its `@created` runs with that one's subtree, its `@destroyed` with it, and a
[context](/composition/context) it reads is the one above **the place it renders**, not the one above
the file it was written in.

That has a consequence worth knowing before you put state in a component you intend to move. A slot
is found again by its position, so two slots that trade content do not trade *instances*:

```tsx
<Dialog
  header={swapped ? <Row name="b" /> : <Row name="a" />}
  footer={swapped ? <Row name="a" /> : <Row name="b" />}
/>
```

Flipping `swapped` looks like the two rows changed places. They did not: the `Row` in the header
stays where it is and is handed the other one's props, and the same for the footer. Nothing is
created and nothing is destroyed — so whatever state each `Row` held stays in the header and the
footer respectively, under new content.

Give them a `key` when you mean the content to carry its state with it:

```tsx
header={swapped ? <Row key="b" name="b" /> : <Row key="a" name="a" />}
```

Then the two are torn down and rebuilt in their new places, which is what moving actually costs.

## Another trap: changing the shape around a slot

A component may return several siblings, so it is natural to wrap a slot in an array. Write the
condition *inside* the array rather than around it:

```tsx
// keeps the slot
render() {
  return [this.props.busy ? <Spinner /> : null, this.props.children];
}

// rebuilds it
render() {
  return this.props.busy ? [<Spinner />, this.props.children] : [this.props.children];
}
```

Both render the same two shapes. The second writes them as two different arrays, so `children` sits
at position 1 in one and position 0 in the other — and position is how a child is found again. The
markup comes out right either way, which is what makes this easy to miss; what goes is the state
inside the slot, because it is torn down and built anew.

A `null` in the array holds the place. That is all the first spelling is doing.

## One trap: passing an unkeyed list as children

If a component wraps its `children` in its own markup, it can't control how the caller
built those children. If the caller passes a bare `.map()`, items get matched by
position — and as the list grows, the wrapper's own markup can be mistaken for a list
item, so state lands on the wrong node. There is no visible error; development reports
it.

The fix is the caller's, and it is [`list()`](/lists) instead of `.map()`:

```tsx
// instead of  {items.map((item) => <li>{item.name}</li>)}
<Panel>{list(items, (item) => <Item item={item} />)}</Panel>
```

`list()` keeps the rows as one child rather than letting them mix with the panel's own
markup, so nothing around them can be confused for part of the list.

It identifies a row by what sets that row apart from its siblings — which works while your
objects are the ones you built, and stops working the moment the data is replaced from
outside: a refetch or a `JSON.parse` hands over objects nothing has seen, so every row is
rebuilt and whatever it was holding goes with it. When that happens, say which field names a
row where the data arrives:

```tsx
this.rows = merge(this.rows, await api.getRows(), (row) => row.id);
```

Said once, at the boundary, rather than on every list that renders those rows.
[`RMD051`](/reference/diagnostics) reports a row that carries nothing to tell it apart, and
[lists](/lists#which-row-is-which) has the whole story.

## Next

- [Error boundaries](/composition/error-boundaries) — containing a failure.
