import { Component, Host, bootstrap, destroyed, interval, mounted, state } from "../framework";

/**
 * A raw interval a component never clears.
 *
 * `setInterval` and `clearInterval` are written undeclared on purpose: the analyzer never
 * typechecks, and a bare name that resolves to NOTHING is how it tells the platform's function from
 * one the app wrote — the same question `browser-url` asks about `location`. Declaring them here
 * would make the rule go quiet and the fixture prove nothing.
 */
@Host("div")
class Ticker extends Component {
  @state n = 0;
  private tick = 0;
  private kept = 0;

  @mounted start() {
    /* REPORTED — the id goes nowhere, so nothing can ever clear it. */
    setInterval(() => this.n++, 1000);

    /* REPORTED — a local dies with the call. */
    const id = setInterval(() => this.n++, 1000);
    void id;

    /* REPORTED — the documented shape done half way: a property nothing names. */
    this.tick = setInterval(() => this.n++, 1000);

    /* Not reported: a property `@destroyed` clears, which is the documented shape. */
    this.kept = setInterval(() => this.n++, 1000);

    /* Not reported: a timeout stops on its own, and telling a long one from a short one is a
       judgement about a number. The runtime catches those, where it can see what is still armed. */
    setTimeout(() => this.n++, 0);
  }

  @destroyed stop() {
    clearInterval(this.kept);
  }

  /* Not reported: the decorator starts on mount and clears itself on unmount. */
  @interval(1000) beat() {
    this.n++;
  }

  render() {
    return <div>{this.n}</div>;
  }
}

/**
 * A property and a local of the SAME NAME, kept apart.
 *
 * One set for both would let the local here silence the property, which is a miss nobody would ever
 * find — it errs towards silence, so it is not a false report, but it is the kind of muddle a later
 * reader has to re-derive.
 */
@Host("div")
class SameName extends Component {
  /* REPORTED — the property is never cleared; only a LOCAL of that name is. */
  private id = 0;

  @mounted start() {
    this.id = setInterval(() => {}, 1000);
    const id = setInterval(() => {}, 1000);
    clearInterval(id);
  }

  render() {
    return <div />;
  }
}

/** A local cleared in the same function is reachable, so it is not this fault. */
@Host("div")
class Once extends Component {
  @mounted start() {
    const id = setInterval(() => {}, 1000);
    clearInterval(id);
  }
  render() {
    return <div />;
  }
}

/**
 * The chain, both ways.
 *
 * A base's members are the component's members, so a `@destroyed` on a shared base answers an
 * interval its subclass started. Reading one class body missed that and reported the subclass.
 */
@Host("div")
abstract class Clearing extends Component {
  protected handle = 0;

  @destroyed stop() {
    clearInterval(this.handle);
  }
}

/** Not reported: the base clears `this.handle`, on the same instance. */
@Host("div")
class StartsBelow extends Clearing {
  @mounted start() {
    this.handle = setInterval(() => {}, 1000);
  }
  render() {
    return <div />;
  }
}

/**
 * The other direction, which cannot be read: a class does not know who extends it. An ABSTRACT one
 * is never mounted on its own, so a property it never clears may be cleared by any subclass — and
 * reporting it would be a guess. A local or a discarded id stays certain, because no subclass can
 * reach either.
 */
@Host("div")
abstract class StartsAbove extends Component {
  protected handle = 0;

  @mounted start() {
    /* Not reported: abstract, and a subclass may be the one clearing `this.handle`. */
    this.handle = setInterval(() => {}, 1000);

    /* REPORTED even here — a local dies with the call, whoever extends this. */
    const local = setInterval(() => {}, 1000);
    void local;
  }
}

/** It IS cleared, one class down — which is the pair the upward walk cannot see. */
@Host("div")
class ClearsAbove extends StartsAbove {
  @destroyed stop() {
    clearInterval(this.handle);
  }
  render() {
    return <div />;
  }
}

bootstrap(<Ticker />, null);
bootstrap(<Once />, null);
bootstrap(<StartsBelow />, null);
bootstrap(<ClearsAbove />, null);
