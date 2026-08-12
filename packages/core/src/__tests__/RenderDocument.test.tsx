import { describe, test, expect } from "vitest";
import { Component } from "../base/Component";
import { Head } from "../base/Head";
import { renderPage } from "../hydration/ssr";
import { renderDocument } from "../hydration/document";
import { hydrateRoot } from "../hydration/hydrate";

class Page extends Component {
  head = this.use(Head, {
    title: "Get started — Ramonda",
    description: "Install it and render your first component.",
  });
  render() {
    return <article>Install it.</article>;
  }
}

describe("renderDocument", () => {
  test("produces a complete document around a rendered page", async () => {
    const page = await renderPage(<Page />);
    const html = renderDocument(page, {
      scripts: ["/assets/client.js"],
      styles: ["/assets/site.css"],
    });

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>Get started — Ramonda</title>");
    expect(html).toContain('name="description"');
    expect(html).toContain('<link rel="stylesheet" href="/assets/site.css">');
    expect(html).toContain('<script type="module" src="/assets/client.js"></script>');
    expect(html).toContain('<div id="app">');
    expect(html).toContain("Install it.");
  });

  test("charset comes before the title", async () => {
    const page = await renderPage(<Page />);
    const html = renderDocument(page);

    // A browser not told the encoding guesses from the first bytes and restarts
    // the parse if it guessed wrong. The spec asks for charset inside the first
    // 1024 bytes, and a long non-ASCII title could push it past that.
    expect(html.indexOf('charset="utf-8"')).toBeLessThan(html.indexOf("<title>"));
  });

  test("escapes a title that would otherwise end the element", async () => {
    class Sharp extends Component {
      head = this.use(Head, { title: "<script>alert(1)</script> & you" });
      render() {
        return <p>x</p>;
      }
    }

    const html = renderDocument(await renderPage(<Sharp />));

    // A doc page named after a tag is an ordinary thing to want, and the title
    // is page data like any other.
    expect(html).toContain("<title>&lt;script&gt;alert(1)&lt;/script&gt; &amp; you</title>");
    expect(html).not.toContain("<title><script>");
  });

  test("escapes a quote in an attribute value", () => {
    const html = renderDocument({ body: "", title: "t", head: "", portals: {} }, { lang: 'en" onload="alert(1)', rootId: "app" });

    expect(html).toContain('lang="en&quot; onload=&quot;alert(1)"');
  });

  test("the options are optional and the defaults are sane", () => {
    const html = renderDocument({ body: "<p>hi</p>", title: "T", head: "", portals: {} });

    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<div id="app"><p>hi</p></div>');
    expect(html).toContain("initial-scale=1");
    expect(html).not.toContain("<script");
  });

  test("headExtra and bodyClass land where they say they do", () => {
    const html = renderDocument(
      { body: "", title: "T", head: "", portals: {} },
      { headExtra: '<link rel="icon" href="/f.svg">', bodyClass: "docs dark" },
    );

    expect(html).toContain('<link rel="icon" href="/f.svg">');
    expect(html).toContain('<body class="docs dark">');
  });
});

describe("the document round-trips: what it writes, hydration adopts", () => {
  test("a page written by renderDocument hydrates without rebuilding", async () => {
    const page = await renderPage(<Page />);
    const html = renderDocument(page, { rootId: "app" });

    // Parse the served document the way a browser would, then hydrate the root
    // element out of it — the whole point of the shell is that `rootId` names
    // the element `hydrateRoot` is given.
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const root = parsed.getElementById("app")!;
    expect(root).toBeTruthy();

    // Move it into the live document so hydration works on a connected tree.
    const container = document.createElement("div");
    container.innerHTML = root.innerHTML;
    document.body.appendChild(container);

    const before = container.firstElementChild;
    hydrateRoot(<Page />, container);
    await Promise.resolve();

    // Adopted, not rebuilt: the element the server wrote is the same object.
    expect(container.firstElementChild).toBe(before);
    expect(container.textContent).toContain("Install it.");

    container.remove();
  });
});
