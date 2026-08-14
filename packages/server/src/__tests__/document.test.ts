import { describe, expect, test } from "vitest";
import { escapeHtml, fillDocument } from "../document";

/**
 * Filling the shell — the step every server render and every prerender ends with, and the one that
 * had the same two bugs in three files.
 *
 * Both were found once and fixed in ONE of the copies. The scaffolded template still shipped them,
 * which is the argument for this package in a sentence: a fix that has to be applied by hand to
 * every app is a fix that reaches one of them.
 */

const SHELL = `<!doctype html><html><head><title>App</title><!--head--></head><body><!--ssr--></body></html>`;

describe("fillDocument puts rendered HTML into the shell", () => {
  test("a `$` sequence in the body survives", () => {
    // `String.prototype.replace` reads `$&` in the REPLACEMENT as "the matched text", so a page
    // rendering it swapped the marker back into its own output. "Save $$ today" is a price, not an
    // edge case, and the corruption is silent — the page still returns 200.
    const html = "<p>Save $& today</p>";
    const out = fillDocument({ template: SHELL, html });

    expect(out).toContain("<p>Save $& today</p>");
    expect(out).not.toContain("<!--ssr-->");
  });

  test("every `$` form, not just the one that was noticed", () => {
    const html = "<p>$$ $& $` $' $1</p>";
    expect(fillDocument({ template: SHELL, html })).toContain("<p>$$ $& $` $' $1</p>");
  });

  test("a `$` sequence in the head survives too", () => {
    const head = `<meta name="description" content="Save $& now">`;
    expect(fillDocument({ template: SHELL, html: "", head })).toContain(head);
  });
});

describe("fillDocument escapes the title", () => {
  test("markup in a title cannot break out of the element", () => {
    // The title is RAW TEXT read back from `document.title`, unlike the head's `<meta>`/`<link>`,
    // which arrive already escaped as `outerHTML`. A page that sets its title from a product name
    // or a search term therefore decides what markup lands in the document.
    const out = fillDocument({ template: SHELL, html: "", title: `</title><script>alert(1)</script>` });

    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&lt;/title&gt;&lt;script&gt;");
  });

  test("a `$` sequence in a title survives, with its `&` escaped as HTML demands", () => {
    // Two different jobs on one string, and the test pins both: `$` must not be read as a replace
    // pattern, while `&` must still become an entity. "Save $& today" is the case where getting
    // one right and the other wrong looks almost identical.
    expect(fillDocument({ template: SHELL, html: "", title: "Save $& today" })).toContain(
      "<title>Save $&amp; today</title>",
    );
  });

  test("no title given leaves the shell's own", () => {
    expect(fillDocument({ template: SHELL, html: "" })).toContain("<title>App</title>");
  });

  test("an EMPTY title leaves the shell's own, because empty means nobody set one", () => {
    // `renderPage` returns `title: ""` when no `Head` in the tree set one, and that is a report of
    // absence rather than a title. Taking it literally emptied the shell's own `<title>` — measured
    // on a scaffolded project, which shipped `<title></title>` where its shell said otherwise.
    expect(fillDocument({ template: SHELL, html: "", title: "" })).toContain("<title>App</title>");
  });
});

describe("fillDocument on a shell that is missing its markers", () => {
  test("returns the shell rather than throwing", () => {
    // A shell with no `<!--ssr-->` is a mistake, but a server that throws on it answers 500 for
    // every route — the emptier page is the more diagnosable failure.
    const bare = "<!doctype html><html><body></body></html>";
    expect(fillDocument({ template: bare, html: "<p>x</p>" })).toBe(bare);
  });
});

describe("escapeHtml", () => {
  test("escapes the three characters that break out of an element", () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe(`&lt;a href="x"&gt;&amp;&lt;/a&gt;`);
  });

  test("escapes `&` first, so an escape is not escaped twice", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  test("takes anything, since an error message is not always a string", () => {
    expect(escapeHtml(undefined)).toBe("undefined");
    expect(escapeHtml(new Error("<boom>"))).toContain("&lt;boom&gt;");
  });
});

/**
 * A portal into a NAMED target has to reach a hand-assembled shell too.
 *
 * `renderDocument` in core emits a container per named target, after the app root. An app that
 * writes its own shell — which both the SSR template and this repository's playground do — had no
 * way to do that, so `renderPage()` collected the blocks and the server dropped them on the floor.
 * The page then looked right and the client built a SECOND copy of the modal on hydration.
 */
describe("fillDocument places named portal targets", () => {
  const SHELL_WITH_PORTALS = `<!doctype html><html><head><title>App</title></head><body><div id="app"><!--ssr--></div><!--portals--></body></html>`;

  test("a container per name, carrying the server's block", () => {
    const out = fillDocument({
      template: SHELL_WITH_PORTALS,
      html: "<p>page</p>",
      portals: { modals: '<!--r7--><div class="modal">hi</div><!--/r7-->' },
    });

    expect(out).toContain('<div data-ramonda-portal-target="modals">');
    expect(out).toContain('<div class="modal">hi</div>');
    // The anchors are what the client hydrates against — dropping them makes it build a second copy.
    expect(out).toContain("<!--r7-->");
    expect(out).not.toContain("<!--portals-->");
  });

  test("outside the app root, which is the whole point of aiming at one", () => {
    const out = fillDocument({ template: SHELL_WITH_PORTALS, html: "<p>page</p>", portals: { modals: "<b>m</b>" } });
    // A modal aims at a container outside the app precisely to escape a stacking context.
    expect(out.indexOf("</div>")).toBeLessThan(out.indexOf("portal-target"));
  });

  test("no portals leaves no marker behind", () => {
    const out = fillDocument({ template: SHELL_WITH_PORTALS, html: "<p>page</p>" });
    expect(out).not.toContain("<!--portals-->");
    expect(out).not.toContain("portal-target");
  });

  test("a `$` sequence inside a portal block survives", () => {
    const out = fillDocument({ template: SHELL_WITH_PORTALS, html: "", portals: { m: "<p>Save $& today</p>" } });
    expect(out).toContain("<p>Save $& today</p>");
  });

  test("a shell with blocks to place and nowhere to put them REFUSES", () => {
    // The one case that must not be quiet. Returning the shell unchanged is right for a missing
    // `<!--ssr-->` — an empty page is obvious. A dropped portal renders a page that looks correct
    // and then builds the modal twice on hydration, which is the kind of fault that ships.
    expect(() =>
      fillDocument({ template: "<html><body><!--ssr--></body></html>", html: "", portals: { modals: "<b>m</b>" } }),
    ).toThrow(/<!--portals-->/);
  });

  test("a name is escaped into the attribute", () => {
    const out = fillDocument({ template: SHELL_WITH_PORTALS, html: "", portals: { 'a"b': "<i>x</i>" } });
    expect(out).toContain('data-ramonda-portal-target="a&quot;b"');
  });
});
