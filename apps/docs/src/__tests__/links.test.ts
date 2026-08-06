// @vitest-environment node
// Reads markdown off disk and touches no DOM. Declared rather than inherited: the config's
// jsdom default cannot resolve `node:` builtins, which is a failure that only appears once
// something sets NODE_ENV — the shape of bug that passes locally and fails on a runner.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every internal link on the site, resolved.
 *
 * ## The fault this exists for
 *
 * `/lens/messages` links each message to the section of the reference that explains its code, and
 * every one of those twenty-two links was dead: the heading is `## RML001 — a path that could not be
 * reached`, so its id is the whole title, and the links said `#rml001`. Nothing noticed. A dead
 * anchor does not 404 — the page loads and the reader lands at the top of a long reference, which
 * reads as "the docs sent me to the wrong place" rather than as a bug.
 *
 * Three more were already dead the same way, one of them pointing at a heading that had been
 * renamed and two at an anchor nobody ever wrote.
 *
 * ## Why it derives the ids rather than listing them
 *
 * The ids come from `scripts/build-content.mjs`, which slugifies each heading — so this repeats that
 * function rather than a table of anchors somebody maintains. A renamed heading then breaks the
 * links that pointed at it, here, instead of silently in the browser.
 *
 * A code section's anchor is its whole title, which is long and moves when the title is reworded.
 * That is the site's existing convention (twenty-odd links use it) and this check is what makes it
 * survivable.
 */

const here = dirname(fileURLToPath(import.meta.url));
const content = join(here, "..", "..", "content");

/** Every markdown file under `content/`, walked by hand — `globSync` needs Node 22 and CI runs 20. */
function pages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) pages(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** `scripts/build-content.mjs`'s `slugify`, kept identical on purpose. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`'"“”‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The route a file is served at: `content/lens/index.md` → `/lens`. */
function routeOf(file: string): string {
  const rel = relative(content, file).replace(/\\/g, "/");
  const path = `/${rel.replace(/\/?index\.md$/, "").replace(/\.md$/, "")}`;
  return path === "/" ? "/" : path;
}

/**
 * The anchors a page offers, by the same rule the build applies: `h2` to `h4`, deduplicated with a
 * numeric suffix. An `h1` gets no id, which is why a link may not point at one.
 */
function anchorsIn(text: string): Set<string> {
  const anchors = new Set<string>();
  for (const [, , heading] of text.matchAll(/^(#{2,4})\s+(.*)$/gm)) {
    let id = slugify(heading);
    if (id === "") continue;
    let n = 2;
    while (anchors.has(id)) id = `${slugify(heading)}-${n++}`;
    anchors.add(id);
  }
  return anchors;
}

const files = pages(content);
const routes = new Map(files.map((file) => [routeOf(file), anchorsIn(readFileSync(file, "utf8"))]));

/** `](/route)`, `](/route#anchor)` and `](#anchor)` — the three shapes an internal link takes. */
const INTERNAL = /\]\((\/[A-Za-z0-9/-]*)?(?:#([A-Za-z0-9-]+))?\)/g;

interface Link {
  from: string;
  route: string;
  anchor: string | undefined;
}

function linksIn(file: string): Link[] {
  const text = readFileSync(file, "utf8");
  const found: Link[] = [];
  for (const [, route, anchor] of text.matchAll(INTERNAL)) {
    if (route === undefined && anchor === undefined) continue;
    found.push({ from: relative(content, file), route: route ?? routeOf(file), anchor });
  }
  return found;
}

const links = files.flatMap(linksIn);

describe("internal links", () => {
  it("finds enough of them to be checking anything", () => {
    // The floor is the same idea as `atLeast` in `check-api-coverage.mjs`: a regex that stopped
    // matching would leave every assertion below passing against nothing.
    expect(links.length).toBeGreaterThan(200);
    expect(routes.size).toBeGreaterThan(60);
  });

  it("points at pages that exist", () => {
    const missing = links
      .filter((link) => !routes.has(link.route))
      .map((link) => `${link.from} → ${link.route}${link.anchor ? `#${link.anchor}` : ""}`);

    expect(missing).toEqual([]);
  });

  it("points at headings that exist", () => {
    const dead = links
      .filter((link) => link.anchor !== undefined && routes.has(link.route))
      .filter((link) => !routes.get(link.route)?.has(link.anchor as string))
      .map((link) => `${link.from} → ${link.route}#${link.anchor}`);

    expect(dead).toEqual([]);
  });

  it("can tell a dead anchor from a live one", () => {
    // The control. Without it, a mistake in `anchorsIn` — a selector that matched every heading,
    // say — would make the two checks above unable to fail.
    const reference = routes.get("/reference/diagnostics");

    expect(reference?.has("rml001-a-path-that-could-not-be-reached")).toBe(true);
    expect(reference?.has("rml001")).toBe(false);
    // `# Immutable updates — RML` is an h1, so it offers no anchor at all.
    expect(reference?.has("immutable-updates-rml")).toBe(false);
  });
});
