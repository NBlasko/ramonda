import { describe, expect, test } from "vitest";
import { installCommands } from "../../scripts/install-commands.mjs";

/**
 * An `install` fence: what to install, written once, and spelled by the build for each manager.
 *
 * Every spelling below was run in an empty project before it was written down — see the note in
 * `install-commands.mjs`. A test cannot run four package managers, so it holds the spellings that
 * were measured, and a change to one is a change somebody has to have run again.
 */
describe("an install fence", () => {
  test("a package and a dev dependency, in every manager", () => {
    expect(Object.fromEntries(installCommands("@ramonda/core\n-D @ramonda/build", "test"))).toEqual({
      npm: "npm install @ramonda/core\nnpm install -D @ramonda/build",
      pnpm: "pnpm add @ramonda/core\npnpm add -D @ramonda/build",
      yarn: "yarn add @ramonda/core\nyarn add -D @ramonda/build",
      bun: "bun add @ramonda/core\nbun add -d @ramonda/build",
    });
  });

  /** `yarn create` installs the starter globally, which fails without write access — not offered. */
  test("a starter, in the managers it was seen to work in", () => {
    expect(Object.fromEntries(installCommands("create ramonda@latest my-app", "test"))).toEqual({
      npm: "npm create ramonda@latest my-app",
      pnpm: "pnpm create ramonda@latest my-app",
      bun: "bun create ramonda@latest my-app",
    });
  });

  test("several packages on a line, with versions", () => {
    expect(installCommands("@ramonda/core@latest @ramonda/router@latest", "test")[0]).toEqual([
      "npm",
      "npm install @ramonda/core@latest @ramonda/router@latest",
    ]);
  });

  /** A whole command written into the fence is the mistake this format exists to stop. */
  test.each([
    ["a command written out", "npm install @ramonda/core"],
    ["a flag it does not know", "--save-exact @ramonda/core"],
    ["a dev flag with nothing after it", "-D"],
  ])("%s fails the build, naming the page", (_what, line) => {
    expect(() => installCommands(line, "guide/x.md")).toThrow(/guide\/x\.md/);
  });
});
