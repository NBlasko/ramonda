import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

/**
 * The scaffolded `scripts/prerender.mjs`, RUN — not read.
 *
 * It is the only writer of `dist/static`, and it never emptied it: a page baked by an earlier build
 * — a route since deleted or renamed, a `sitemap.xml` written then — stayed in the folder, and
 * `build:static` copies the whole folder into the site. Found by the second trial: a stale
 * `sitemap.xml` went out with a test address in it.
 *
 * `@ramonda/server` is not this package's dependency, so the project gets a stand-in for the two
 * functions the script calls. What is measured is what the script does with files, which the
 * stand-in does not touch.
 */
const template = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
  "ssr",
  "scripts",
  "prerender.mjs",
);

let project: string;
afterEach(() => rmSync(project, { recursive: true, force: true }));

function arrange(paths: string[]): void {
  project = mkdtempSync(join(tmpdir(), "ramonda-prerender-"));
  mkdirSync(join(project, "scripts"));
  cpSync(template, join(project, "scripts", "prerender.mjs"));
  const server = join(project, "node_modules", "@ramonda", "server");
  mkdirSync(server, { recursive: true });
  writeFileSync(
    join(server, "package.json"),
    JSON.stringify({ name: "@ramonda/server", type: "module", exports: "./index.js" }),
  );
  writeFileSync(
    join(server, "index.js"),
    "export const installDom = () => {};\nexport const fillDocument = ({ html }) => html;\n",
  );
  mkdirSync(join(project, "dist", "client"), { recursive: true });
  writeFileSync(join(project, "dist", "client", "index.html"), "<!doctype html>");
  mkdirSync(join(project, "dist", "server"), { recursive: true });
  writeFileSync(
    join(project, "dist", "server", "entry-server.js"),
    `export const staticPaths = () => ${JSON.stringify(paths)};\n` +
      "export const notFoundPath = () => undefined;\n" +
      "export const prerender = async (path) => ({ html: `<p>${path}</p>`, title: '', head: '', lang: 'en', dir: 'ltr', portals: '' });\n",
  );
}

function prerender(): void {
  const run = spawnSync(process.execPath, [join(project, "scripts", "prerender.mjs")], {
    cwd: project,
    encoding: "utf8",
  });
  expect(run.stderr).toBe("");
  expect(run.status).toBe(0);
}

describe("the scaffolded prerender script", () => {
  test("bakes each static route", () => {
    arrange(["/", "/about"]);
    prerender();
    expect(existsSync(join(project, "dist", "static", "index.html"))).toBe(true);
    expect(existsSync(join(project, "dist", "static", "about", "index.html"))).toBe(true);
  });

  test("leaves nothing from an earlier build: a route since removed, a file written then", () => {
    arrange(["/"]);
    mkdirSync(join(project, "dist", "static", "old-route"), { recursive: true });
    writeFileSync(join(project, "dist", "static", "old-route", "index.html"), "<p>old</p>");
    writeFileSync(join(project, "dist", "static", "sitemap.xml"), "<urlset>http://test.example</urlset>");

    prerender();

    expect(existsSync(join(project, "dist", "static", "index.html"))).toBe(true);
    expect(existsSync(join(project, "dist", "static", "old-route"))).toBe(false);
    expect(existsSync(join(project, "dist", "static", "sitemap.xml"))).toBe(false);
  });
});
