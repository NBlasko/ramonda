---
title: created
description: Run a method while the component is being built — before its element exists.
section: Reference
order: 123
---

# `@created`

Runs while the component is being built, **before its element exists**. This is where a component
sets itself up from its props and seeds its state.

## The situation it is for

A wizard that starts on whichever step the URL asked for, and remembers where the reader got to from
there. The starting value comes from a prop; every value after that comes from the reader:

```tsx
class Wizard extends Component<{ startAt: number; steps: string[] }> {
  @state step = 0;

  @created
  begin() {
    this.step = this.props.startAt;
  }

  next() {
    this.step = Math.min(this.step + 1, this.props.steps.length - 1);
  }

  render() {
    return (
      <section>
        <h2>{this.props.steps[this.step]}</h2>
        <button onclick={this.next}>Next</button>
      </section>
    );
  }
}
```

The seeding belongs here rather than in the field's initializer because a field cannot read
`this.props` — the props are not there yet when initializers run. `@created` is the first moment
they are.

See [Lifecycle](/concepts/lifecycle) for how it sits beside the other three.

## Running on one side only

A component is built on the server as well as in the browser. `env` says where the method belongs:

```tsx
@created({ env: "client" })
startPolling() {}

@created({ env: "server" })
stampBuildTime() {}

@created
init() {} // both — the default
```

The method is handed the side it is actually on, so one method can branch instead of two declaring
opposite `env`s:

```tsx
@created
setup(env: RenderEnv) {
  if (env === "client") this.listen();
}
```

A method that declares no parameter is still fine — fewer parameters is always assignable.

## What it refuses

**Anything but a method.** It runs code; a field has nothing to run.

**The DOM.** There is no element yet, so nothing here can find, measure or focus this component's
markup. That is [`@mounted`](/reference/decorators/mounted).

## What it costs

Nothing, but an `async` one has a trap. A rejection with no `try` or `.catch` is reported as
[`RMD059`](/reference/diagnostics/rmd059) at runtime, and `ramonda-check` reports the same shape
from the source as [`unguarded-async-lifecycle`](/rules/unguarded-async-lifecycle). The component
carries on being built either way — the failure does not stop it, which is exactly why it has to be
handled where it happens.

## Next

- [Lifecycle](/concepts/lifecycle) — all four moments, in order.
- [`@mounted`](/reference/decorators/mounted) — the one that can reach the page.
