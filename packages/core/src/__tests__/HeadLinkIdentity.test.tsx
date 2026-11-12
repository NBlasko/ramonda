import { beforeEach, describe, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Head, resetHeadRegistry } from "../base/Head";
import { renderPage } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";

/**
 * A `<link>` is identified by `rel` and `href` — and by `hreflang` and `sizes` when it has them.
 *
 * Found by an agent building a two-language site from the docs: the standard alternates are one link
 * per language plus `hreflang="x-default"`, and `x-default` points at the same address as the default
 * language's page. Identified by `rel` and `href` alone, the two became one, and the baked page lost a
 * language with no message anywhere. An icon in several sizes from one file is the same shape.
 */
const ALTERNATES = [
  { rel: "alternate", hreflang: "sr-Latn", href: "https://x.example/" },
  { rel: "alternate", hreflang: "en", href: "https://x.example/en" },
  { rel: "alternate", hreflang: "x-default", href: "https://x.example/" },
];
const ICONS = [
  { rel: "icon", sizes: "16x16", href: "/icon.svg" },
  { rel: "icon", sizes: "32x32", href: "/icon.svg" },
];

class Landing extends Component {
  head = this.use(Head, () => ({ link: [...ALTERNATES, ...ICONS] }));
  render() {
    return <p>x</p>;
  }
}

beforeEach(() => resetHeadRegistry());

describe("a link's identity", () => {
  test("two alternates to one address in two languages are two links, on the server", async () => {
    const { head } = await renderPage(<Landing />);
    expect(head.match(/hreflang="sr-Latn"/g)).toHaveLength(1);
    expect(head.match(/hreflang="x-default"/g)).toHaveLength(1);
    expect(head.match(/rel="icon"/g)).toHaveLength(2);
  });

  test("and in the browser", async () => {
    await getDOM(<Landing />);
    const languages = [...document.head.querySelectorAll('link[rel="alternate"]')].map((link) =>
      link.getAttribute("hreflang"),
    );
    expect(languages.sort()).toEqual(["en", "sr-Latn", "x-default"]);
    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(2);
  });

  test("and hydrating adopts the server's links instead of adding a second set", async () => {
    const page = await renderPage(<Landing />);
    document.head.insertAdjacentHTML("beforeend", page.head);
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;
    hydrateRoot(<Landing />, container);
    await Promise.resolve();

    expect(document.head.querySelectorAll('link[rel="alternate"]')).toHaveLength(3);
    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(2);
    container.remove();
  });
});
