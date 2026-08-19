import { Component, Host, bootstrap, onDocument, onElement, onWindow, state } from "../framework";
import { Panel } from "./base";

/** No `@Host`, so the host is `<ramonda-host>` — `display: contents`, and no box. */
class Bare extends Component {
  @state hits = 0;

  /* REPORTED — and it never arrives at all, because `mouseenter` does not bubble. */
  @onElement("mouseenter") onEnter() {}

  /* REPORTED — a click still reaches it from the children, so this one half works. */
  @onElement("click") onClick() {}

  /* Not reported: these two resolve to the globals, whatever the host is. */
  @onWindow("resize") onResize() {}
  @onDocument("keydown") onKey() {}

  render() {
    return <p>{this.hits}</p>;
  }
}

/** A real element, so the listener has a box to sit on. */
@Host("div")
class Boxed extends Component {
  @onElement("mouseenter") onEnter() {}
  render() {
    return <p>fine</p>;
  }
}

/** `@Host` is inherited, so this one has a real element too. */
class Inherits extends Panel {
  @onElement("mouseenter") onEnter() {}
}

bootstrap(<Bare />, null);
bootstrap(<Boxed />, null);
bootstrap(<Inherits />, null);
