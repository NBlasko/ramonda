import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { withoutItsApi } from "../adapters/typescriptApi";
import { ramondaCss as viteCss } from "../adapters/vite";
import { ramondaCss as esbuildCss } from "../adapters/esbuild";
import { builtFromThisSource } from "./built";

/** What TypeScript 7's package exports, measured on 7.0.2: a version, and no API. */
vi.mock("typescript", () => {
  const ts7 = { version: "7.0.2", versionMajorMinor: "7.0" };
  return { default: ts7, ...ts7 };
});

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("TypeScript 7, which has no JavaScript API", () => {
  test("is named, with the version installed and the one to install", () => {
    expect(withoutItsApi({ version: "7.0.2" })).toBe(
      "TypeScript 7.0.2 is installed, and it has no JavaScript API to read your source with. " +
        "Install TypeScript 5 or 6: `npm install -D typescript@5`.",
    );
    expect(withoutItsApi({ version: "5.9.3", createProgram: () => {} })).toBeUndefined();
  });

  test("stops both plugins when they are made, not at the first file", () => {
    expect(() => viteCss()).toThrow("[ramonda-css] TypeScript 7.0.2 is installed");
    expect(() => esbuildCss()).toThrow("[ramonda-css] TypeScript 7.0.2 is installed");
  });

  test("is outside the peer range, so npm refuses the install", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8"));
    expect(manifest.peerDependencies.typescript).toBe(">=5.4.0 <7");
  });

  describe("the bin", () => {
    beforeAll(builtFromThisSource);

    let root: string | undefined;
    afterEach(() => root && rmSync(root, { recursive: true, force: true }));

    test("says it and exits 1, instead of crashing on a property of undefined", () => {
      root = mkdtempSync(join(tmpdir(), "ramonda-css-ts7-"));
      writeFileSync(join(root, "tsconfig.json"), "{}");
      let output = "";
      let status = 0;
      try {
        execFileSync(
          process.execPath,
          ["--import", join(PACKAGE, "src", "__tests__", "fakeTypescript7.mjs"), join(PACKAGE, "bin.mjs")],
          { cwd: root, encoding: "utf8", stdio: "pipe" },
        );
      } catch (error) {
        const failed = error as { stdout?: string; stderr?: string; status?: number };
        output = `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
        status = failed.status ?? -1;
      }
      expect(status).toBe(1);
      expect(output).toContain("[ramonda-css] TypeScript 7.0.2 is installed, and it has no JavaScript API");
      expect(output).not.toContain("Cannot read properties");
    });
  });
});
