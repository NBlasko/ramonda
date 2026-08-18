import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Component, Host, Head, renderPage, renderDocument } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { Router, RouteOutlet, Navigator } from "../Router";
import { createRoutes, routePaths } from "../match";

/**
 * The whole static build, end to end: a route table in, a set of complete HTML
 * documents out.
 *
 * This is the test that says the pipeline exists. Each piece has its own tests —
 * `Head` in core, `renderDocument` in core, `routePaths` below — but a static
 * site is the four of them in a loop, and the interesting failures live between
 * them: a title that leaks from the previous page, a route that renders the
 * wrong component because the URL was never changed, a `:param` page silently
 * missing from the output.
 *
 * **It also settles a design question.** `apps/playground-ssr/server.mjs` builds
 * a fresh JSDOM for every REQUEST, because concurrent requests would otherwise
 * share one `window.location`. A build loop is sequential, so it does not need
 * that — this renders every page into ONE document, changing only the URL, and
 * each page comes out correct. That is the difference between a build that takes
 * a second and one that pays for a DOM per page.
 */

@Host("main")
class Home extends Component {
  head = this.use(Head, () => ({
    title: "Ramonda",
    description: "A class-based frontend framework.",
  }));
  render() {
    return <h1>Home</h1>;
  }
}

@Host("main")
class Guide extends Component {
  head = this.use(Head, () => ({
    title: "Guide — Ramonda",
    description: "Learn Ramonda step by step.",
    link: [{ rel: "canonical", href: "https://example.dev/guide" }],
  }));
  render() {
    return <h1>Guide</h1>;
  }
}

@Host("main")
class Player extends Component {
  route = this.use(Navigator);
  head = this.use(Head, (self: Player) => ({
    title: `Player ${self.route.params<{ id: string }>().id}`,
  }));
  render() {
    return <h1>Player {this.route.params<{ id: string }>().id}</h1>;
  }
}

const routes = createRoutes({
  "/": <Home />,
  "/guide": <Guide />,
  "/players/:id": <Player />,
  "*": <Home />,
});

@Host("div")
class App extends Component<{ children?: RamondaNode }> {
  router = this.use(Router);
  render() {
    return <RouteOutlet routes={routes} />;
  }
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("routePaths", () => {
  test("separates the pages it can enumerate from the ones it cannot", () => {
    const { paths, needsData } = routePaths(routes);

    expect(paths).toEqual(["/", "/guide"]);
    // `/players/:id` is one route and any number of pages. A build that
    // enumerated the table and stopped would ship a site missing all of them,
    // and nothing about the output would look wrong.
    expect(needsData).toEqual(["/players/:id"]);
  });

  test("extra paths are appended, so the dynamic pages get built", () => {
    const { paths } = routePaths(routes, ["/players/1", "/players/2"]);
    expect(paths).toEqual(["/", "/guide", "/players/1", "/players/2"]);
  });

  test("the fallback is not a page", () => {
    // `*` matches whatever matched nothing, so it has no URL of its own. A 404
    // is rendered explicitly, at whatever path the host expects.
    expect(routePaths(routes).paths).not.toContain("*");
  });
});

describe("the build loop", () => {
  /** Exactly what a build script does, minus writing to disk. */
  async function build(extra: readonly string[] = []) {
    const { paths } = routePaths(routes, extra);
    const out = new Map<string, string>();

    for (const path of paths) {
      // The only per-page setup there is. No new JSDOM, no new module graph.
      window.history.pushState(null, "", path);
      const page = await renderPage(<App />);
      out.set(path, renderDocument(page, { scripts: ["/assets/client.js"] }));
    }

    return out;
  }

  test("every page gets its own title, description and body", async () => {
    const site = await build();

    const home = site.get("/")!;
    expect(home).toContain("<title>Ramonda</title>");
    expect(home).toContain("A class-based frontend framework.");
    expect(home).toContain("<h1>Home</h1>");

    const guide = site.get("/guide")!;
    expect(guide).toContain("<title>Guide — Ramonda</title>");
    expect(guide).toContain("Learn Ramonda step by step.");
    expect(guide).toContain("<h1>Guide</h1>");
  });

  test("no page carries the previous page's head", async () => {
    const site = await build();

    // The failure this catches is invisible in any single page: render `/` then
    // `/guide` and, without a reset, the guide ships two descriptions and the
    // home page's canonical URL — telling a crawler they are the same page.
    expect(site.get("/")!).not.toContain("Learn Ramonda step by step");
    expect(site.get("/")!).not.toContain("canonical");
    expect(site.get("/guide")!).not.toContain("A class-based frontend framework");

    const descriptions = site.get("/guide")!.match(/name="description"/g) ?? [];
    expect(descriptions.length).toBe(1);
  });

  test("dynamic pages render with their own params", async () => {
    const site = await build(["/players/7", "/players/42"]);

    expect(site.get("/players/7")!).toContain("<h1>Player 7</h1>");
    expect(site.get("/players/7")!).toContain("<title>Player 7</title>");
    expect(site.get("/players/42")!).toContain("<h1>Player 42</h1>");
    expect(site.get("/players/42")!).toContain("<title>Player 42</title>");
  });

  test("every document is complete and self-contained", async () => {
    const site = await build(["/players/1"]);

    for (const [path, html] of site) {
      expect(html.startsWith("<!doctype html>"), path).toBe(true);
      expect(html.includes("</html>"), path).toBe(true);
      expect(html.includes('charset="utf-8"'), path).toBe(true);
      expect(html.includes('<div id="app">'), path).toBe(true);
      expect(html.includes('<script type="module" src="/assets/client.js">'), path).toBe(true);
      // The state blob is what makes hydration cheap — every carrier carries it.
      expect(html.includes("data-ramonda-state"), path).toBe(true);
    }
  });

  test("a crawler that runs no JavaScript still reads the page", async () => {
    const site = await build();

    // The reason any of this exists. Strip every script and the content, the
    // title and the description are all still there — which is what the
    // crawlers feeding search engines and AI assistants actually index.
    const withoutScripts = site.get("/guide")!.replace(/<script[\s\S]*?<\/script>/g, "");

    expect(withoutScripts).toContain("<h1>Guide</h1>");
    expect(withoutScripts).toContain("<title>Guide — Ramonda</title>");
    expect(withoutScripts).toContain("Learn Ramonda step by step.");
  });

  test("the loop is repeatable — a second build matches the first", async () => {
    const first = await build(["/players/3"]);
    const second = await build(["/players/3"]);

    // Byte-for-byte. A build whose output depended on what ran before it would
    // make every deploy a diff nobody can review.
    for (const [path, html] of first) {
      expect(second.get(path), path).toBe(html);
    }
  });
});
