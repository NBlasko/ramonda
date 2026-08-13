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

`list()` gives each item a stable identity, so nothing around it can be confused for
part of it.

## Next

- [Error boundaries](/composition/error-boundaries) — containing a failure.
