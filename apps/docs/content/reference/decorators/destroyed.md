---
title: destroyed
description: Run a method while the component is being removed — the place to undo whatever it set up.
section: Reference
order: 125
---

# `@destroyed`

Runs while the component is being removed. Whatever it set up that the framework does not own comes
undone here.

## The situation it is for

A price ticker on a socket. The component opens the connection when it appears and has to close it
when it goes — because nothing else will, and a socket left open keeps receiving, keeps calling
back, and keeps a component alive that the page has already forgotten:

```tsx
class Ticker extends Component<{ symbol: string }> {
  @state price = "—";
  private socket?: WebSocket;

  @mounted
  connect() {
    const socket = new WebSocket("wss://example.test");
    socket.onmessage = (e) => {
      this.price = String(e.data);
    };
    this.socket = socket;
  }

  @destroyed
  disconnect() {
    this.socket?.close();
  }

  render() {
    return <p>{this.props.symbol} {this.price}</p>;
  }
}
```

Take the `@destroyed` away and the page still works — which is the trouble. The socket keeps
arriving, `this.price = …` keeps being called on a component nobody can see, and the only sign is a
report ([`RMD008`](/reference/diagnostics/rmd008)) that a state write had nowhere to go.

## What you do NOT have to undo

Most of it. A great deal of cleanup that other frameworks ask for is already done:

- **State, computes and props** go with the component.
- **[`@interval`](/reference/decorators/interval) and
  [`@timeout`](/reference/decorators/timeout)**, and the `Interval` / `Timeout` hooks, clear
  themselves.
- **[`@onWindow`](/reference/decorators/onWindow) and
  [`@onDocument`](/reference/decorators/onDocument)** remove their listeners.
- **A [subscription decorator](/hooks/own-decorators)** runs the cleanup its connect returned.

What is left is what you reached for yourself: a socket, an observer, a handle from a library that
is not Ramonda's.

## Running on one side only

It takes `env`, like [`@created`](/reference/decorators/created). A server render tears nothing
down, so this is a browser moment in practice.

## What it refuses

**Anything but a method.**

## What it costs

Nothing to declare it. What it costs to get *wrong* is a leak: something that outlives the component
and writes state into it is reported as [`RMD008`](/reference/diagnostics/rmd008) — the write is
dropped, the render it asked for never happens, and the only sign is a value that stopped moving.

## Next

- [Lifecycle](/concepts/lifecycle) — all four moments, in order.
- [Your own decorators](/hooks/own-decorators) — a subscription that cleans up without this.
