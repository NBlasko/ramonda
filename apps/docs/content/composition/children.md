---
title: Children and slots
description: Passing markup into a component, and the one trap that comes with it.
section: Composition
order: 72
---

# Children and slots

`children` is an ordinary prop.

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

## Several slots

There is no slot syntax. If you need more than one, take more than one prop — they are just
values, and a vnode is a value.

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

## The trap: an unkeyed list from the caller

A component that renders `{this.props.children}` **with chrome around it** cannot control how the
caller produced those children. If the caller passes an unkeyed `.map()`, the diff matches by
position — and when the list grows, the component's own chrome can be claimed as a list item.

```tsx
// The caller:
<Panel>
  {items.map((item) => <li>{item.name}</li>)}
</Panel>
```

The symptom is state landing on the wrong node, not a visible error. Development reports it as a
diagnostic on the caller's side.

**The fix belongs to the caller**, and it is [`list()`](/lists): its vnodes come out with identity,
so the diff claims by identity rather than by position and nothing after the list can be mistaken
for part of it.

This is a genuine caller dependency, and it is the same one every framework with children has. The
diagnostic is what makes it loud instead of silent.

## Why there is no `<Fragment>` for grouping children

A tag that is not an element would break the one rule the framework is built on. If you need
several nodes at one position, `render()` may return an **array** — see
[components](/concepts/components).

## Next

- [Error boundaries](/composition/error-boundaries) — containing a failure.
