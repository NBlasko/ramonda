import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * TypeScript 7 has no JavaScript API, and the analyzer is built on it: under 7.0.2 the bin stopped
 * on *Cannot read properties of undefined (reading 'QuestionQuestionToken')*, while loading — before
 * any of its own code could say anything. So the bin asks first.
 */
describe("TypeScript 7, which has no JavaScript API", () => {
  test("the bin says it and exits 1, instead of crashing while it loads", () => {
    let output = "";
    let status = 0;
    try {
      execFileSync(
        process.execPath,
        ["--import", join(PACKAGE, "src", "__tests__", "fakeTypescript7.mjs"), join(PACKAGE, "bin.mjs")],
        { cwd: PACKAGE, encoding: "utf8", stdio: "pipe" },
      );
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; status?: number };
      output = `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
      status = failed.status ?? -1;
    }
    expect(status).toBe(1);
    expect(output).toContain(
      "[ramonda-check] TypeScript 7.0.2 is installed, and it has no JavaScript API to read your source with. " +
        "Install TypeScript 5 or 6: `npm install -D typescript@5`.",
    );
    expect(output).not.toContain("Cannot read properties");
  });

  test("is outside the peer range, so npm refuses the install", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8"));
    expect(manifest.peerDependencies.typescript).toBe(">=5.0.0 <7");
  });
});
