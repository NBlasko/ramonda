import { Component, bootstrap, state } from "../framework";

declare const document: {
  body: { className: string; classList: DOMTokenList; style: Record<string, string> };
  documentElement: { classList: DOMTokenList; style: Record<string, string> };
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

class App extends Component {
  render() {
    return (
      <div>
        <Astray />
        <Commanding />
        <Building />
      </div>
    );
  }
}

bootstrap(<App />, null);
