import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";

/**
 * `ramonda-check explain` and `ramonda-check docs`: the docs this version was released with, read
 * with no network. Run through the shipped launcher, over a small set of pages standing in for the
 * packed docs — `apps/docs` runs the same commands over the real ones.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function packed(): string {
  const dir = mkdtempSync(join(tmpdir(), "check-docs-"));
  scratch.push(dir);
  const pages: Record<string, string> = {
    "llms.txt": "# Ramonda\n\n> The index.\n",
    "index.md": "# Ramonda\n",
    "forms/fields.md": "# Fields\n",
    "reference/diagnostics/rmd020.md": "# RMD020 — rendered twice\n",
    "reference/diagnostics/rmd022.md": "# RMD022 — a props callback\n",
    "rules/unknown-hook-option.md": "# unknown-hook-option\n",
  };
  for (const [file, text] of Object.entries(pages)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

const run = (docs: string | undefined, ...args: string[]) => {
  const env = { ...process.env };
  if (docs === undefined) env.RAMONDA_CHECK_DOCS = join(tmpdir(), "no-such-docs-folder");
  else env.RAMONDA_CHECK_DOCS = docs;
  const result = spawnSync(process.execPath, [join(root, "bin.mjs"), ...args], { encoding: "utf8", env });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

describe("ramonda-check explain", () => {
  test("prints a code's page, in any case", () => {
    const docs = packed();
    for (const asked of ["RMD020", "rmd020"]) {
      const { status, stdout } = run(docs, "explain", asked);
      expect(status).toBe(0);
      expect(stdout).toBe("# RMD020 — rendered twice\n");
    }
  });

  test("prints a rule's page", () => {
    expect(run(packed(), "explain", "unknown-hook-option").stdout).toBe("# unknown-hook-option\n");
  });

  test("a code or a rule it does not have names the closest it does, and exits 1", () => {
    const docs = packed();
    const code = run(docs, "explain", "RMD02");
    expect(code.status).toBe(1);
    expect(code.stderr).toContain("no diagnostic RMD02");
    expect(code.stderr).toContain("Did you mean RMD020, RMD022?");
    const rule = run(docs, "explain", "unknown-hook-optio");
    expect(rule.stderr).toContain("Did you mean unknown-hook-option?");
  });

  test("with nothing to explain, says how it is asked", () => {
    const { status, stderr } = run(packed(), "explain");
    expect(status).toBe(2);
    expect(stderr).toContain("ramonda-check explain RMD020");
  });

  test("an install with no docs says so, names the page on the web, and exits 2", () => {
    const { status, stdout, stderr } = run(undefined, "explain", "RMD020");
    expect(status).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("https://ramonda.dev/reference/diagnostics/rmd020");
  });
});

describe("ramonda-check docs", () => {
  test("with no page, prints the index of every page", () => {
    expect(run(packed(), "docs").stdout).toBe("# Ramonda\n\n> The index.\n");
  });

  test("a page by its path, however it is written — and the site's address of it", () => {
    const docs = packed();
    for (const asked of ["forms/fields", "/forms/fields", "forms/fields.md", "https://ramonda.dev/forms/fields.md"]) {
      expect(run(docs, "docs", asked).stdout, asked).toBe("# Fields\n");
    }
  });

  test("a page it does not have names the closest one, and exits 1", () => {
    const { status, stderr } = run(packed(), "docs", "forms/feilds");
    expect(status).toBe(1);
    expect(stderr).toContain("Did you mean forms/fields?");
  });
});

/**
 * Output bigger than a pipe holds. A write to a pipe is asynchronous and `process.exit` does not wait
 * for it, so a page past 64 KB was cut when read through a pipe — which is how a program reads it, and
 * the same for `--json`. Found by review; `ramonda-css` had met it and works around it the same way.
 */
describe("a page bigger than a pipe", () => {
  test("comes back whole", () => {
    const docs = packed();
    const big = `# Big\n\n${"a line of text that is long enough to add up quickly.\n".repeat(4000)}`;
    writeFileSync(join(docs, "big.md"), big);
    const { status, stdout } = run(docs, "docs", "big");
    expect(status).toBe(0);
    expect(stdout.length).toBe(big.length);
  });
});

/**
 * `ramonda-check docs` meant "check the project in ./docs" before it was a command — a folder is read as
 * the tsconfig inside it — and a CI step written that way kept passing while checking nothing, by
 * printing the docs instead. Where that folder exists, the word is still the project. Found by review.
 */
describe("a folder named like a command", () => {
  test("is still the project it names", () => {
    const cwd = mkdtempSync(join(tmpdir(), "check-docs-folder-"));
    scratch.push(cwd);
    mkdirSync(join(cwd, "docs"));
    writeFileSync(
      join(cwd, "docs", "tsconfig.json"),
      JSON.stringify({ compilerOptions: { jsx: "preserve" }, files: [] }),
    );
    const result = spawnSync(process.execPath, [join(root, "bin.mjs"), "docs"], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, RAMONDA_CHECK_DOCS: packed() },
    });
    expect(result.stdout).not.toContain("# Ramonda");
    expect(`${result.stdout}${result.stderr}`).toContain("[ramonda-check]");
  });
});
