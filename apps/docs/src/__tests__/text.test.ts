import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { SITE, llmsIndex, pageText, textPath } from "../../scripts/page-text.mjs";
import { pages } from "../generated/content";

/**
 * The site as a coding agent reads it — a `.md` per page, `llms.txt`, `llms-full.txt`.
 *
 * Found by an agent that built an app from these docs alone and read them as HTML: the prerendered
 * app, with its navigation, its highlighting spans and its script bundles. What it is handed now is
 * the text the pages are rendered from, and these tests hold that text to the pages.
 */
const here = dirname(fileURLToPath(import.meta.url));
const textDir = join(here, "..", "generated", "text");
const paths = new Set(["/", "/concepts/state", "/guide/installation"]);

describe("a page as Markdown", () => {
  const text = (body: string, title = "T") => pageText(body, { title, pages: paths, where: "test" });

  test("a demo has no text, and goes with the blank line after it", () => {
    expect(text("# T\n\nBefore.\n\n```demo:Counter\n```\n\nAfter.\n")).toBe("# T\n\nBefore.\n\nAfter.\n");
  });

  test("an install fence is the npm commands, the first tab the page shows", () => {
    expect(text("# T\n\n```install\n@ramonda/core\n-D @ramonda/build\n```\n")).toBe(
      "# T\n\n```sh\nnpm install @ramonda/core\nnpm install -D @ramonda/build\n```\n",
    );
  });

  test("a link to a page goes to its Markdown, absolute, and keeps its anchor", () => {
    expect(text("# T\n\nSee [state](/concepts/state#what-it-is) and [home](/).\n")).toBe(
      `# T\n\nSee [state](${SITE}/concepts/state.md#what-it-is) and [home](${SITE}/index.md).\n`,
    );
  });

  test("a link to anything else on the site keeps its address, made absolute", () => {
    expect(text("# T\n\n![a gif](/media/x.gif)\n")).toBe(`# T\n\n![a gif](${SITE}/media/x.gif)\n`);
  });

  test("a fence keeps its info string, which says when an example is wrong on purpose", () => {
    const body = "# T\n\n```tsx expect-report:row-without-a-key\nlist(a, (x) => <p />)\n```\n";
    expect(text(body)).toBe(body);
  });

  test("nothing inside a fence is rewritten — a link there is code", () => {
    const body = "# T\n\n```md\n[state](/concepts/state)\n```\n";
    expect(text(body)).toBe(body);
  });

  test("a build marker is dropped, with or without its note", () => {
    expect(text('# T\n\n[rules:start]: # "generated"\n\nRow.\n\n[rules:end]: #\n')).toBe("# T\n\nRow.\n");
  });

  test("a page whose body does not start with its title gets one", () => {
    expect(text("Just prose.\n", "Title")).toBe("# Title\n\nJust prose.\n");
  });
});

describe("llms.txt", () => {
  const index = llmsIndex(
    [
      { path: "/", title: "Home", description: "What it is.", section: "" },
      { path: "/concepts/state", title: "State", description: "", section: "Core concepts" },
      { path: "/reference/diagnostics/rmd001", title: "RMD001", description: "x", section: "Diagnostics" },
    ],
    { name: "Ramonda", summary: "A framework.", leaveOut: new Set(["Diagnostics"]) },
  );

  test("says what the site is, groups the pages by section, and leaves out what an index page lists", () => {
    expect(index).toContain("# Ramonda\n\n> A framework.");
    expect(index).toContain(`## Overview\n\n- [Home](${SITE}/index.md): What it is.`);
    expect(index).toContain(`## Core concepts\n\n- [State](${SITE}/concepts/state.md)\n`);
    expect(index).not.toContain("RMD001");
  });
});

describe("what the build wrote", () => {
  test("the site's address is the one the server renders against", () => {
    const server = readFileSync(join(here, "..", "entry-server.tsx"), "utf8");
    expect(server).toContain(`export const BASE = "${SITE}";`);
  });

  test("every page has its Markdown, and nothing else is there", () => {
    const written = (function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(dir, entry.name))
          : entry.name.endsWith(".md")
            ? [`/${relative(textDir, join(dir, entry.name)).split("\\").join("/")}`]
            : [],
      );
    })(textDir).sort();
    expect(written).toEqual(pages.map((page) => textPath(page.path)).sort());
  });

  test("every link to the site's Markdown is a file the build wrote", () => {
    const full = readFileSync(join(textDir, "llms-full.txt"), "utf8");
    const index = readFileSync(join(textDir, "llms.txt"), "utf8");
    const links = new Set(
      [...`${full}\n${index}`.matchAll(/https:\/\/ramonda\.dev(\/[\w/.-]*\.md)/g)].map((match) => match[1]),
    );
    expect(links.size).toBeGreaterThan(200);
    const missing = [...links].filter((link) => !existsSync(join(textDir, link)));
    expect(missing).toEqual([]);
  });

  test("no demo, no relative link and no build marker reached the text", () => {
    const full = readFileSync(join(textDir, "llms-full.txt"), "utf8");
    // Outside fences only: a code example may well hold a path.
    const prose = full.replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "");
    expect(full).not.toMatch(/^```demo:/m);
    expect(prose).not.toMatch(/\]\(\//);
    expect(prose).not.toMatch(/^\[[^\]]+\]: #/m);
  });

  test("llms.txt lists every page but a code's and a rule's, which their index pages list", () => {
    const index = readFileSync(join(textDir, "llms.txt"), "utf8");
    for (const page of pages) {
      const listed = index.includes(`(${SITE}${textPath(page.path)})`);
      expect(listed, page.path).toBe(page.section !== "Diagnostics" && page.section !== "Rules");
    }
  });
});
