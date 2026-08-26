import { describe, test, expect } from "vitest";
import { Component } from "../../base/Component";
import { state, created } from "../../base/decorators";
import { renderPage, renderToString } from "../../hydration/ssr";
import { Portal } from "../../base/Portal";
import { hydrateRoot } from "../../hydration/hydrate";
import { findAll } from "../../test/setup";

/**
 * The state blob travels inside a comment, and a comment ends at the first `-->`.
 *
 * State is user data as often as not — a name, a note, a search string, a row out of a database. A
 * value holding `-->` used to close its own marker, and everything after it in that value was
 * parsed as MARKUP: measured on `--><img src=x onerror=…><!--`, one real `<img>` with a live
 * `onerror` in the served page. An attribute could not do this, because the serializer escapes one.
 *
 * So the pair of dashes is escaped on the way out, and `JSON.parse` reads it straight back — the
 * blob is only ever consumed by parsing it, so nothing on the client has to know.
 */

const nasty = '--><img src=x onerror="window.__pwned=1"><!--';

class Note extends Component {
  @state text = "";
  @created load() {
    this.text = nasty;
  }
  render() {
    return <p id="note">{this.text}</p>;
  }
}

class Page extends Component {
  render() {
    return (
      <div id="shell">
        <Note />
      </div>
    );
  }
}

async function served(vnode: Parameters<typeof renderToString>[0]) {
  const html = await renderToString(vnode);
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.innerHTML = html;
  return { html, container };
}

describe("the marker blob", () => {
  test("a state value cannot close the comment it travels in", async () => {
    const { html, container } = await served(<Page />);

    // What the browser parsed is what the server wrote: nothing escaped the comment.
    expect(container.innerHTML).toBe(html);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(html).not.toContain('{"state":{"text":"-->');

    // And the value itself is still in the page as TEXT, where it belongs.
    expect(container.querySelector("#note")!.textContent).toBe(nasty);
    container.remove();
  });

  test("and hydration reads the same string back", async () => {
    const { container } = await served(<Page />);

    hydrateRoot(<Page />, container);
    await Promise.resolve();

    const note = findAll<Note>(container, "Note")[0]!;
    expect(note.text).toBe(nasty);
    expect(container.querySelector("#note")!.textContent).toBe(nasty);
    // The markers are consumed and gone, as they are for any component.
    expect(container.innerHTML).toBe(
      '<div id="shell"><p id="note">' + nasty.replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p></div>",
    );
    container.remove();
  });

  test("a text child in a collected block is escaped on the way out", async () => {
    /**
     * The same family as the blob above, one seam over. A head or portal block is collected node by
     * node: an element goes through `outerHTML`, which escapes what is inside it, and a TEXT node was
     * handed back raw. So a value a component rendered into the head reached the page as MARKUP.
     */
    class Page extends Component {
      @state label = "";
      @created({ env: "shared" }) load() {
        this.label = '</title><img src=x onerror="window.__pwned=1">';
      }
      portal = this.use(Portal, (self: Page) => ({
        children: ["prefix ", self.label],
        target: document.head,
      }));
      render() {
        return <div id="body">body</div>;
      }
    }

    const page = await renderPage(<Page />);

    expect(page.head).toContain("&lt;/title&gt;");
    expect(page.head).not.toContain("<img");

    // And it parses back to the text it was, rather than to a tag.
    const host = document.createElement("div");
    host.innerHTML = page.head;
    expect(host.querySelectorAll("img")).toHaveLength(0);
    expect(host.textContent).toBe('prefix </title><img src=x onerror="window.__pwned=1">');
  });

  test("a run of dashes survives the round trip", async () => {
    const dashes = "a---b----c-";
    class Dashes extends Component {
      @state text = "";
      @created load() {
        this.text = dashes;
      }
      render() {
        return <p id="dashes">{this.text}</p>;
      }
    }
    class Shell extends Component {
      render() {
        return (
          <div id="shell">
            <Dashes />
          </div>
        );
      }
    }

    const { html, container } = await served(<Shell />);

    // The blob itself, without the markers around it: no pair of dashes is left in it.
    const blob = html.match(/<!--c\d+ (.*?)-->/)![1];
    expect(blob).toContain("a-");
    expect(blob).not.toContain("--");

    hydrateRoot(<Shell />, container);
    await Promise.resolve();

    expect(findAll<Dashes>(container, "Dashes")[0]!.text).toBe(dashes);
    container.remove();
  });
});
