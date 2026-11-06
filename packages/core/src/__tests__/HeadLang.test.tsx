import { describe, test, expect, beforeEach } from "vitest";
import { Component } from "../base/Component";
import { Head, resetHeadRegistry } from "../base/Head";
import { state } from "../base/decorators";
import { renderPage, renderStatic } from "../hydration/ssr";
import { renderDocument } from "../hydration/document";
import { getDOM } from "../test/setup";

/**
 * `<html lang>` and `<html dir>` from a component, through `Head`.
 *
 * Found by an agent building a bilingual app from the docs alone: the language changes when the
 * reader switches it, and the docs said plainly there was no declarative way to say so. The answer was
 * an imperative write in `@mounted` that the checker refuses. A screen reader picks its pronunciation
 * from `lang`, and a right-to-left language without `dir` is half a page.
 *
 * Through `Head` and not a hook of its own, because it needs exactly what `Head` already is: the deeper
 * one wins, a page that goes away hands the value back, and the server writes what the client will
 * find.
 */
const html = () => document.documentElement;

beforeEach(() => {
  resetHeadRegistry();
  html().removeAttribute("lang");
  html().removeAttribute("dir");
  document.title = "";
});

describe("on the client", () => {
  test("sets lang and dir on <html>", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({ lang: "ar", dir: "rtl" as const }));
      render() {
        return <p>مرحبا</p>;
      }
    }
    await getDOM(<Page />);
    expect(html().getAttribute("lang")).toBe("ar");
    expect(html().getAttribute("dir")).toBe("rtl");
  });

  test("dir chosen by a condition compiles with nothing pinned, as a reader writes it", async () => {
    class App extends Component {
      @state locale = "ar";
      head = this.use(Head, (self: App) => ({ lang: self.locale, dir: self.locale === "ar" ? "rtl" : "ltr" }));
      render() {
        return <p>{this.locale}</p>;
      }
    }
    await getDOM(<App />);
    expect(html().getAttribute("dir")).toBe("rtl");
  });

  test("follows the reader switching language", async () => {
    class App extends Component {
      @state locale = "sr";
      head = this.use(Head, (self: App) => ({ lang: self.locale }));
      render() {
        return <p>{this.locale}</p>;
      }
    }
    const { instance, settle } = await getDOM<App>(<App />);
    expect(html().getAttribute("lang")).toBe("sr");
    instance.locale = "en";
    await settle();
    expect(html().getAttribute("lang")).toBe("en");
  });

  test("a deeper Head wins, and one that says nothing about it leaves it alone", async () => {
    class Quote extends Component {
      head = this.use(Head, () => ({ lang: "fr", title: "Citation" }));
      render() {
        return <q>bonjour</q>;
      }
    }
    class Plain extends Component {
      head = this.use(Head, () => ({ title: "Plain" }));
      render() {
        return <Quote />;
      }
    }
    class App extends Component {
      head = this.use(Head, () => ({ lang: "en" }));
      render() {
        return <Plain />;
      }
    }
    await getDOM(<App />);
    expect(html().getAttribute("lang")).toBe("fr");
  });

  test("hands back what <html> had when the page goes away", async () => {
    html().setAttribute("lang", "en");
    class Page extends Component {
      head = this.use(Head, () => ({ lang: "sr", dir: "ltr" as const }));
      render() {
        return <p>zdravo</p>;
      }
    }
    const { unmount } = await getDOM(<Page />);
    expect(html().getAttribute("lang")).toBe("sr");
    unmount();
    expect(html().getAttribute("lang")).toBe("en");
    // `dir` was not there before, so it is not there after.
    expect(html().hasAttribute("dir")).toBe(false);
  });

  test("does not undo a value something else wrote since", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({ lang: "sr" }));
      render() {
        return <p>zdravo</p>;
      }
    }
    const { unmount } = await getDOM(<Page />);
    html().setAttribute("lang", "de");
    unmount();
    expect(html().getAttribute("lang")).toBe("de");
  });
});

describe("when the registry is reset", () => {
  /**
   * The reset is a REQUEST boundary — a server rendering request after request into one document, and
   * tests — never a page in a browser. So it hands `<html>` back whatever wrote it since: a value left
   * there is the next request's language. A first review asked for the page-going-away rule here
   * (restore only while still ours); a second measured what that does on a server — one request's
   * `de` served to the next, which said nothing — and it was taken out again.
   */
  test("hands back what <html> had, whatever wrote it since — the next request must not inherit it", async () => {
    html().setAttribute("lang", "en");
    class Page extends Component {
      head = this.use(Head, () => ({ lang: "fr" }));
      render() {
        return <p>bonjour</p>;
      }
    }
    await getDOM(<Page />);
    expect(html().getAttribute("lang")).toBe("fr");
    html().setAttribute("lang", "de");
    resetHeadRegistry();
    expect(html().getAttribute("lang")).toBe("en");
  });

  test("and does hand it back while it is still the Head's", async () => {
    html().setAttribute("lang", "en");
    class Page extends Component {
      head = this.use(Head, () => ({ lang: "fr" }));
      render() {
        return <p>bonjour</p>;
      }
    }
    await getDOM(<Page />);
    resetHeadRegistry();
    expect(html().getAttribute("lang")).toBe("en");
  });
});

describe("on the server", () => {
  test("renderPage returns them beside the title", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({ title: "Turniri", lang: "sr", dir: "ltr" as const }));
      render() {
        return <p>zdravo</p>;
      }
    }
    const page = await renderPage(<Page />);
    expect(page.lang).toBe("sr");
    expect(page.dir).toBe("ltr");
  });

  test("a page that says nothing returns nothing, rather than what the server's document had", async () => {
    html().setAttribute("lang", "xx");
    class Page extends Component {
      render() {
        return <p>plain</p>;
      }
    }
    const page = await renderPage(<Page />);
    expect(page.lang).toBeUndefined();
    expect(page.dir).toBeUndefined();
  });

  test("and so does a page whose Head sets only a title", async () => {
    // The server's own document may carry a `lang`; only what a `Head` set is the page's.
    html().setAttribute("lang", "xx");
    class Page extends Component {
      head = this.use(Head, () => ({ title: "Plain" }));
      render() {
        return <p>plain</p>;
      }
    }
    const page = await renderPage(<Page />);
    expect(page.title).toBe("Plain");
    expect(page.lang).toBeUndefined();
  });

  test("each page gets its own — the build loop does not carry one into the next", async () => {
    class Serbian extends Component {
      head = this.use(Head, () => ({ lang: "sr" }));
      render() {
        return <p>zdravo</p>;
      }
    }
    class Silent extends Component {
      render() {
        return <p>…</p>;
      }
    }
    expect((await renderPage(<Serbian />)).lang).toBe("sr");
    expect((await renderPage(<Silent />)).lang).toBeUndefined();
    expect(html().hasAttribute("lang")).toBe(false);
  });

  test("a static render returns them too", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({ lang: "sr" }));
      render() {
        return <p>zdravo</p>;
      }
    }
    const baked = await renderStatic(<Page />, new URL("http://x.test/"));
    expect(baked.lang).toBe("sr");
  });

  test("renderDocument writes the page's lang over its own default, and the dir beside it", async () => {
    class Page extends Component {
      head = this.use(Head, () => ({ lang: "ar", dir: "rtl" as const }));
      render() {
        return <p>مرحبا</p>;
      }
    }
    const doc = renderDocument(await renderPage(<Page />), { lang: "en" });
    expect(doc).toContain('<html lang="ar" dir="rtl">');

    class Silent extends Component {
      render() {
        return <p>…</p>;
      }
    }
    expect(renderDocument(await renderPage(<Silent />), { lang: "sr" })).toContain('<html lang="sr">');
    expect(renderDocument(await renderPage(<Silent />))).toContain('<html lang="en">');
  });
});
