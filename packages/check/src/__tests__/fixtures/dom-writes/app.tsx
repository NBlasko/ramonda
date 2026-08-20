import { Component, bootstrap, mounted, state } from "../framework";
import { applyTheme } from "./theme";

declare const document: {
  body: {
    className: string;
    classList: DOMTokenList;
    style: Record<string, string> & { setProperty(k: string, v: string): void };
  };
  documentElement: { classList: DOMTokenList; style: Record<string, string>; innerHTML: string };
  getElementById(id: string): HTMLElement | null;
  querySelector(css: string): HTMLElement | null;
  createElement(tag: string): HTMLElement;
};
interface DOMTokenList {
  add(name: string): void;
  remove(name: string): void;
  toggle(name: string, on?: boolean): void;
}
interface HTMLElement {
  className: string;
  textContent: string;
  classList: DOMTokenList;
  style: Record<string, string>;
  setAttribute(name: string, value: string): void;
  scrollIntoView(): void;
  focus(): void;
  getBoundingClientRect(): { top: number };
}

/** Every one of these writes what a render could have said, on an element it did not render. */
class Astray extends Component {
  @state open = false;

  sync(): void {
    document.documentElement.classList.toggle("nav-locked", this.open);
    document.body.className = "locked";
    document.body.style.overflow = "hidden";
    document.getElementById("panel")?.setAttribute("aria-hidden", "true");
    document.querySelector(".badge")!.textContent = "9";
    // Any assignment operator, not just `=`: `+=` on a class is the commonest spelling of all.
    document.body.className += " open";
    document.body.style.setProperty("--accent", "red");
    document.body.style["overflow"] = "hidden";
    document.documentElement.innerHTML += "<i></i>";
  }

  render() {
    return <span>astray</span>;
  }
}

/**
 * Commands, not rendering. None of these is reported, and that is the line the rule draws: they
 * tell the browser to DO something and have no declarative form.
 */
class Commanding extends Component {
  act(): void {
    document.getElementById("top")?.scrollIntoView();
    document.querySelector("input")?.focus();
    const box = document.body.getBoundingClientRect?.();
    void box;
  }
  render() {
    return <span>commanding</span>;
  }
}

/** An element the component built itself is its own to fill in. */
class Building extends Component {
  make(): void {
    const style = document.createElement("style");
    style.textContent = ".x { color: red }";
    style.setAttribute("data-mine", "1");
  }
  render() {
    return <span>building</span>;
  }
}

/** The same two hops, for the write half. */
class WritesViaAHelper extends Component {
  private paint(): void {
    document.body.classList.add("dark");
  }
  @mounted go() {
    this.paint();
  }
  render() {
    return <span>helper</span>;
  }
}

/** NOT reported, for the reason in the rule's docstring — the report has no path to offer. */
class WritesViaAnotherFile extends Component {
  @mounted go() {
    applyTheme(true);
  }
  render() {
    return <span>import</span>;
  }
}

class App extends Component {
  render() {
    return (
      <div>
        <Astray />
        <Commanding />
        <Building />
        <WritesViaAHelper />
        <WritesViaAnotherFile />
      </div>
    );
  }
}

bootstrap(<App />, null);
