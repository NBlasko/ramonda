// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADD_ONS, HELP } from "../../../../packages/create-ramonda/src/args";

/**
 * The pages that list packages, held to the packages and to the scaffolder that adds them.
 *
 * Found by an agent building an app from the docs alone: the Installation page listed six of the
 * scaffolder's eight choices, the API reference had no section for `@ramonda/css`, and no page said
 * which packages exist at all — it took `npm search` to learn there were twelve. Each list was
 * written by hand beside the thing it described, and each drifted from it.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..", "..");
const content = join(here, "..", "..", "content");
const page = (path: string) => readFileSync(join(content, path), "utf8");

const published = readdirSync(join(repo, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .map((folder) => JSON.parse(readFileSync(join(repo, "packages", folder, "package.json"), "utf8")))
  .filter((pkg) => !pkg.private)
  .map((pkg) => pkg.name as string);

describe("the packages", () => {
  it("every published package has a row in the API reference's table, and a section", () => {
    const api = page("reference/api.md");
    const start = api.indexOf("## The packages");
    expect(start).toBeGreaterThan(-1);
    const table = api.slice(start, api.indexOf("\n## ", start + 1));
    expect(published.length).toBeGreaterThan(10);
    for (const name of published) {
      expect(table, `no row for ${name}`).toContain(`\`${name}\``);
      // create-ramonda is run, not imported, so it has no exports to list.
      if (name !== "create-ramonda") expect(api, `no section for ${name}`).toContain(`## \`${name}\``);
    }
  });
});

describe("the scaffolder's page", () => {
  const cli = () => page("reference/create-ramonda.md");

  it("names every flag `--help` prints", () => {
    const flags = [...new Set(HELP.match(/--[a-z][a-z-]*/g))];
    expect(flags.length).toBeGreaterThan(8);
    for (const flag of flags) expect(cli(), `no ${flag}`).toContain(`\`${flag}`);
  });

  it("names every add-on by the word `--add` takes", () => {
    for (const addon of ADD_ONS) expect(cli(), `no ${addon}`).toMatch(new RegExp(`\\| \`${addon}\` \\|`));
  });

  it("states the Node it needs, the one the CLI refuses below", () => {
    const source = readFileSync(join(repo, "packages", "create-ramonda", "src", "index.ts"), "utf8");
    const min = /export const MIN_NODE = (\d+);/.exec(source)?.[1];
    expect(min).toBeDefined();
    expect(cli()).toContain(`Node ${min}`);
    expect(page("guide/installation.md")).toContain(`Node ${min}`);
  });

  it("is where the Installation page sends a reader for the choices", () => {
    expect(page("guide/installation.md")).toContain("](/reference/create-ramonda)");
  });
});
