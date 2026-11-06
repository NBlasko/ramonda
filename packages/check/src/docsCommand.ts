import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `ramonda-check explain <code|rule>` and `ramonda-check docs [page]`: the docs for the version that
 * is installed, as text, with no network.
 *
 * Found by an agent that built an app from the docs alone. Every diagnostic it met was a code, and
 * the code's page was on a site describing the LATEST release, reached by fetching HTML. The text
 * here is the site's own Markdown, packed into this package when it was released — see
 * `scripts/pack-docs-text.mjs` — so it is the page for the code this version prints.
 *
 * Read from `docs/` beside the build. `RAMONDA_CHECK_DOCS` points somewhere else, for a test.
 */
const SITE = "https://ramonda.dev";

function docsDir(): string {
  return process.env.RAMONDA_CHECK_DOCS ?? fileURLToPath(new URL("../docs", import.meta.url));
}

/** Every page there, as the path it is asked for by: `forms/fields`, `reference/diagnostics/rmd020`. */
function pagesIn(dir: string): string[] {
  return (readdirSync(dir, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[])
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split("\\").join("/").slice(0, -3))
    .sort();
}

/** Levenshtein distance, for naming what a slip was meant to be. */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return previous[b.length];
}

/** Up to three names close to `asked`, closest first. */
function closest(asked: string, among: readonly string[]): string[] {
  return among
    .map((name) => ({ name, at: distance(asked, name) }))
    .filter((one) => one.at <= Math.max(2, Math.floor(asked.length / 3)))
    .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((one) => one.name);
}

/** Says why there is nothing to read, and where the same page is on the web. Exit 2: nothing could be read. */
function absent(tag: string, online: string): never {
  console.error(
    `${tag} the docs are not in this install of @ramonda/check — a build from the repository has none\n` +
      `until a release packs them. The page is at ${online}`,
  );
  process.exit(2);
}

/** `explain <code|rule>` — a diagnostic code (`RMD020`, `rmq001`) or a checker rule (`unknown-hook-option`). */
export function explain(tag: string, asked: string | undefined): never {
  if (asked === undefined || asked.startsWith("-")) {
    console.error(`${tag} explain takes a code or a rule: ramonda-check explain RMD020`);
    process.exit(2);
  }
  const code = /^rm[dqfl]\d+$/i.test(asked);
  const path = code ? `reference/diagnostics/${asked.toLowerCase()}` : `rules/${asked}`;
  const dir = docsDir();
  if (!existsSync(join(dir, "llms.txt"))) absent(tag, `${SITE}/${path}`);

  const file = join(dir, `${path}.md`);
  if (existsSync(file)) {
    process.stdout.write(readFileSync(file, "utf8"));
    process.exit(0);
  }
  const family = code ? "reference/diagnostics/" : "rules/";
  const known = pagesIn(dir)
    .filter((page) => page.startsWith(family))
    .map((page) => page.slice(family.length))
    .map((name) => (code ? name.toUpperCase() : name));
  const meant = closest(code ? asked.toUpperCase() : asked, known);
  console.error(
    `${tag} no ${code ? "diagnostic" : "rule"} ${code ? asked.toUpperCase() : `\`${asked}\``} in this version.` +
      (meant.length > 0 ? ` Did you mean ${meant.join(", ")}?` : "") +
      ` Every ${code ? "code" : "rule"}: ramonda-check docs ${code ? "reference/diagnostics" : "rules"}`,
  );
  process.exit(1);
}

/** `docs [page]` — a page by its path, or with none, the index of every page. */
export function docs(tag: string, asked: string | undefined): never {
  const dir = docsDir();
  if (!existsSync(join(dir, "llms.txt"))) absent(tag, asked === undefined ? `${SITE}/llms.txt` : `${SITE}/${asked}`);
  if (asked === undefined) {
    process.stdout.write(readFileSync(join(dir, "llms.txt"), "utf8"));
    process.exit(0);
  }
  // `forms/fields`, `/forms/fields`, `forms/fields.md`, or the page's address on the site.
  const path = asked
    .replace(/^https?:\/\/ramonda\.dev/, "")
    .replace(/^\/+/, "")
    .replace(/\.md$/, "")
    .replace(/\/$/, "");
  const file = join(dir, `${path === "" ? "index" : path}.md`);
  if (existsSync(file)) {
    process.stdout.write(readFileSync(file, "utf8"));
    process.exit(0);
  }
  const meant = closest(path, pagesIn(dir));
  console.error(
    `${tag} no page \`${path}\` in these docs.` +
      (meant.length > 0 ? ` Did you mean ${meant.join(", ")}?` : "") +
      " Every page: ramonda-check docs",
  );
  process.exit(1);
}
