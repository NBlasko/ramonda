import { describe, test, expect, beforeEach } from "vitest";
import { Component } from "../base/Component";
import { Head, resetHeadRegistry } from "../base/Head";
import { state } from "../base/decorators";
import { renderPage, renderStatic } from "../hydration/ssr";
import { renderDocument } from "../hydration/document";
import { getDOM } from "../test/setup";

/**
 * `data-*` on `<html>` from a component, through `Head` — a theme above all: `[data-theme="dark"]` is
 * the selector the token docs teach, and `<html>` is the only element every block sits under.
 *
 * The docs said there was no declarative answer, and showed a `ramonda-check-ignore` on an imperative
 * write in `@mounted` instead — an ignore for a VALID design, which an ignore is never for. Through
 * `Head`, with `lang`'s rules, because it needs what `Head` already is: the deeper one wins, a page
 * that goes away hands the value back, and the server writes what the client will find.
 *
 * Only `data-*`. A `class` on `<html>` would be a second way to say the same thing.
 */
const html = () => document.documentElement;

beforeEach(() => {
  resetHeadRegistry();
  for (const name of html().getAttributeNames()) if (name.startsWith("data-")) html().removeAttribute(name);
  document.title = "";
});

describe("on the client", () => {
  test("sets data-* on <html>", async () => {
    class App extends Component {
      head = this.use(Head, () => ({ data: { theme: "dark", density: "compact" } }));
      render() {
        return <p>dark</p>;
      }
    }
    await getDOM(<App />);
    expect(html().getAttribute("data-theme")).toBe("dark");
    expect(html().getAttribute("data-density")).toBe("compact");
  });

  test("follows the reader switching theme", async () => {
    class App extends Component {
      @state theme = "light";
      head = this.use(Head, (self: App) => ({ data: { theme: self.theme } }));
      render() {
        return <p>{this.theme}</p>;
      }
    }
    const { instance, settle } = await getDOM<App>(<App />);
    expect(html().getAttribute("data-theme")).toBe("light");
    instance.theme = "dark";
    await settle();
    expect(html().getAttribute("data-theme")).toBe("dark");
  });

  test("a deeper Head wins per key; another key beside it stays, and undefined leaves it alone", async () => {
    class Preview extends Component {
      head = this.use(Head, () => ({ data: { theme: "dark", density: undefined } }));
      render() {
        return <p>preview</p>;
      }
    }
    class App extends Component {
      head = this.use(Head, () => ({ data: { theme: "light", density: "compact" } }));
      render() {
        return <Preview />;
      }
    }
    await getDOM(<App />);
    expect(html().getAttribute("data-theme")).toBe("dark");
    expect(html().getAttribute("data-density")).toBe("compact");
  });

  test("hands back what <html> had when the page goes away", async () => {
    html().setAttribute("data-theme", "system");
    class Page extends Component {
      head = this.use(Head, () => ({ data: { theme: "dark", density: "compact" } }));
      render() {
        return <p>dark</p>;
      }
    }
    const { unmount } = await getDOM(<Page />);
    expect(html().getAttribute("data-theme")).toBe("dark");
    unmount();
    expect(html().getAttribute("data-theme")).toBe("system");
    // `data-density` was not there before, so it is not there after.
    expect(html().hasAttribute("data-density")).toBe(false);
  });

  test("a key no Head names any more is handed back, while the page stays", async () => {
    class App extends Component {
      @state preview = true;
      head = this.use(Head, (self: App) => ({ data: self.preview ? { theme: "dark" } : {} }));
      render() {
        return <p>{String(this.preview)}</p>;
      }
    }
    const { instance, settle } = await getDOM<App>(<App />);
    expect(html().getAttribute("data-theme")).toBe("dark");
    instance.preview = false;
    await settle();
    expect(html().hasAttribute("data-theme")).toBe(false);
  });

  test("does not undo a value something else wrote since", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({ data: { theme: "dark" } }));
      render() {
        return <p>dark</p>;
      }
    }
    const { unmount } = await getDOM(<Page />);
    html().setAttribute("data-theme", "sepia");
    unmount();
    expect(html().getAttribute("data-theme")).toBe("sepia");
  });

  /**
   * A key is written as it appears after `data-`, the way a selector names it. `colorScheme` would be
   * `data-colorscheme` in HTML (attribute names are lowercased), which no `[data-color-scheme]`
   * selector matches — so it is refused rather than written somewhere nothing reads.
   */
  test("a key that is not a data attribute's name is refused, naming it", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({ data: { colorScheme: "dark" } }));
      render() {
        return <p>dark</p>;
      }
    }
    await expect(getDOM(<Page />)).rejects.toThrow(/`colorScheme`.*data-color-scheme/s);
  });
});

describe("when the registry is reset", () => {
  test("hands back what <html> had — the next request must not inherit a theme", async () => {
    html().setAttribute("data-theme", "light");
    class Page extends Component {
      head = this.use(Head, () => ({ data: { theme: "dark", density: "compact" } }));
      render() {
        return <p>dark</p>;
      }
    }
    await getDOM(<Page />);
    resetHeadRegistry();
    expect(html().getAttribute("data-theme")).toBe("light");
    expect(html().hasAttribute("data-density")).toBe(false);
  });
});

describe("on the server", () => {
  test("renderPage returns them beside lang", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({ lang: "sr", data: { theme: "dark" } }));
      render() {
        return <p>tamno</p>;
      }
    }
    const page = await renderPage(<Page />);
    expect(page.lang).toBe("sr");
    expect(page.data).toEqual({ theme: "dark" });
  });

  test("a page that says nothing returns nothing, rather than what the server's document had", async () => {
    html().setAttribute("data-theme", "xx");
    class Page extends Component {
      render() {
        return <p>plain</p>;
      }
    }
    expect((await renderPage(<Page />)).data).toBeUndefined();
  });

  test("each page gets its own — the build loop does not carry one into the next", async () => {
    class Dark extends Component {
      head = this.use(Head, () => ({ data: { theme: "dark" } }));
      render() {
        return <p>dark</p>;
      }
    }
    class Silent extends Component {
      render() {
        return <p>…</p>;
      }
    }
    expect((await renderPage(<Dark />)).data).toEqual({ theme: "dark" });
    expect((await renderPage(<Silent />)).data).toBeUndefined();
    expect(html().hasAttribute("data-theme")).toBe(false);
  });

  test("a static render returns them too", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({ data: { theme: "dark" } }));
      render() {
        return <p>dark</p>;
      }
    }
    expect((await renderStatic(<Page />, new URL("http://x.test/"))).data).toEqual({ theme: "dark" });
  });

  test("renderDocument writes them on <html>, escaped", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({ lang: "sr", data: { theme: 'da"rk' } }));
      render() {
        return <p>dark</p>;
      }
    }
    expect(renderDocument(await renderPage(<Page />))).toContain('<html lang="sr" data-theme="da&quot;rk">');
  });
});
