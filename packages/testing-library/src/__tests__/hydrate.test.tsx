import { describe, test, expect, vi, afterEach } from "vitest";
import { Component, Host, state, persist, created, onElement, renderToString, type RamondaNode } from "@ramonda/core";
import { render, fireEvent, cleanup } from "../index";

/**
 * `render(ui, { hydrate })` adopts server markup instead of building the DOM.
 *
 * The string form exists because of what a hydration test is: it needs the
 * server's HTML in a container BEFORE anything mounts. Doing that by hand means
 * creating the container yourself, which takes it out of the harness's hands and
 * out of automatic cleanup — and hydration tests are exactly where a leaked tree
 * hurts most, since the next test then hydrates on top of a live one.
 */

@Host("div")
class Greeting extends Component<{ name?: string }> {
  @persist rendered = "server";
  @state clicks = 0;

  @created seed() {
    this.rendered = this.rendered === "server" ? "hydrated" : "server";
  }

  @onElement("click") bump() {
    this.clicks = this.clicks + 1;
  }

  render(): RamondaNode {
    return (
      <p>
        hello {this.props.name ?? "world"} ({this.clicks})
      </p>
    );
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("render with hydrate", () => {
  test("adopts the server's markup rather than rebuilding it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const html = await renderToString(<Greeting name="ada" />);
    expect(html).toContain("hello ada");

    const { container, getByText } = render(<Greeting name="ada" />, {
      hydrate: html,
    });

    expect(getByText(/hello ada/)).toBeTruthy();
    // One tree, not two: a rebuild would have appended alongside the markup.
    expect(container.querySelectorAll("p").length).toBe(1);
  });

  test("the adopted tree is live — listeners are attached", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const html = await renderToString(<Greeting />);

    const { container, getByText } = render(<Greeting />, { hydrate: html });

    fireEvent.click(container.querySelector("div")!);

    // Hydration that produced markup but no listeners is the classic silent
    // failure — the page looks right and does nothing.
    expect(getByText(/\(1\)/)).toBeTruthy();
  });

  test("a hydrated tree is cleaned up like any other", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const html = await renderToString(<Greeting />);

    const { container } = render(<Greeting />, { hydrate: html });
    expect(container.isConnected).toBe(true);

    cleanup();

    // The container was the harness's, because `hydrate` took the markup rather
    // than making the test build a container to put it in.
    expect(container.isConnected).toBe(false);
  });

  test("hydrate: true adopts what is already in a supplied container", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const html = await renderToString(<Greeting name="grace" />);

    const mine = document.createElement("main");
    mine.innerHTML = html;
    document.body.appendChild(mine);

    const { getByText } = render(<Greeting name="grace" />, {
      container: mine,
      hydrate: true,
    });

    expect(getByText(/hello grace/)).toBeTruthy();
    expect(mine.querySelectorAll("p").length).toBe(1);

    cleanup();
    mine.remove();
  });
});
