import { Component, Host, bootstrap, onDocument, onElement, onWindow, state } from "@ramonda/core";
import { Panel } from "./base";

/** No `@Host`, so the host is `<ramonda-host>` — `display: contents`, and no box. */
class Bare extends Component {
  @state hits = 0;

  /* REPORTED — `mouseenter` needs a box to enter, and there is none. It never arrives. */
  @onElement("mouseenter") onEnter() {}
  /* REPORTED — `focus` needs something focusable, and a boxless host is not. */
  @onElement("focus") onFocus() {}

  /* NOT reported, and this is the case that narrowed the rule after it was questioned: a click on a
     child reaches this listener perfectly well. Bubbling needs an ANCESTOR, not a box — measured,
     the handler ran and the count went up. Reporting it was reporting working code. */
  @onElement("click") onClick() {}
  @onElement("input") onInput() {}

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
