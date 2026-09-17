import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { NO_COMPILER } from "../plugin";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const EXTENSION = join(ROOT, "tools", "vscode-css");
const STAGED = join(EXTENSION, "node_modules", "@ramonda", "css");

/**
 * The plugin the extension contributes, and the two things about it that are easy to get wrong.
 *
 * The extension names `@ramonda/css/plugin` in `contributes.typescriptServerPlugins`, which VS Code
 * passes as `--globalPlugins` to BOTH of an editor's TypeScript servers — including the syntax one,
 * which never opens a `tsconfig.json` and so has no plugin of its own. Measured through a real
 * `tsserver`, formatting a file that holds a block: 20 edits without it, 0 with it.
 */
describe("the plugin the extension contributes", () => {
  test("is staged where `tsserver` looks for it, and not only in `exports`", () => {
    execFileSync("node", [join(EXTENSION, "build-plugin.mjs")], { stdio: "pipe" });

    /**
     * **A bare subpath, because `tsserver` does not read `exports`.**
     *
     * Measured: with the entry declared only in `exports`, the load from the extension FAILED and
     * the log fell through to the next candidate path — where, in this repository, the workspace's
     * own copy was found and everything looked fine. Away from the repository it would find nothing.
     */
    expect(existsSync(join(STAGED, "plugin.js"))).toBe(true);
    expect(existsSync(join(STAGED, "dist", "plugin.cjs"))).toBe(true);

    // And through Node's resolver too, which DOES read `exports` — the shim is required that way.
    const from = createRequire(join(EXTENSION, "node_modules", "x.js"));
    expect(from.resolve("@ramonda/css/plugin")).toBe(join(STAGED, "plugin.js"));
  });

  test("is a factory function, which is all `tsserver` checks before using it", () => {
    execFileSync("node", [join(EXTENSION, "build-plugin.mjs")], { stdio: "pipe" });
    const from = createRequire(join(EXTENSION, "node_modules", "x.js"));

    expect(typeof from("@ramonda/css/plugin")).toBe("function");
  });

  /**
   * The name has to be the one a project writes in its `tsconfig.json`.
   *
   * `enableGlobalPlugins` skips a global name the project already lists, which is what keeps the
   * plugin from being loaded twice in the semantic server. A different name would load both.
   */
  test("is contributed under the name a project's tsconfig uses", () => {
    const manifest = JSON.parse(readFileSync(join(EXTENSION, "package.json"), "utf8"));
    const [contributed] = manifest.contributes.typescriptServerPlugins;

    expect(contributed.name).toBe("@ramonda/css/plugin");
    /**
     * Without this, VS Code passes the NAME and never the path to find it by — measured in its own
     * `getTsServerArgs`, which adds the probe location only for the TypeScript it ships. This
     * package tells people to use the workspace version, so the flag is not optional.
     */
    expect(contributed.enableForWorkspaceTypeScriptVersions).toBe(true);
  });

  /**
   * The hand-over, which is the whole reason a shim is staged rather than the plugin.
   *
   * Contributing a plugin puts the extension's directory FIRST in `tsserver`'s candidate paths, and
   * a plugin named in a `tsconfig.json` is resolved from that same list. Measured on one project
   * before and after the contribution: `Loading @ramonda/css/plugin from …/tools/vscode-css`. So
   * without the hand-over the extension would quietly take over checking for every project,
   * replacing whatever `@ramonda/css` that project installed and pinned.
   *
   * ## And why every branch is asserted
   *
   * `tsserver` logs a plugin that throws in `create` as `Plugin activation failed`, at INFO level,
   * and keeps the un-proxied language service. Nothing is shown. So a shim that can throw turns a
   * style block into a syntax error in the editor with no message anywhere — which is the failure
   * the extension exists to remove, arriving by the one door nobody watches.
   */
  describe("and hands over to the project's own copy", () => {
    /**
     * A project with a plugin of its own, written here so each branch can be provoked.
     *
     * `plugin.js` at the bare subpath, not only in `exports`: `tsserver` resolves with TypeScript's
     * own node10 resolver and does not read `exports`. The shim uses Node's, which reads both.
     */
    function project(body: string): string {
      const directory = mkdtempSync(join(tmpdir(), "ramonda-shim-"));
      const own = join(directory, "node_modules", "@ramonda", "css");
      mkdirSync(own, { recursive: true });
      writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "theirs", version: "1.0.0" }));
      writeFileSync(
        join(own, "package.json"),
        JSON.stringify({ name: "@ramonda/css", version: "9.9.9", exports: { "./plugin": "./plugin.js" } }),
      );
      writeFileSync(join(own, "plugin.js"), body);
      return directory;
    }

    /**
     * Run in a CHILD process with `NODE_PATH` cleared, and that is not tidiness.
     *
     * pnpm puts its hoisted directory on `NODE_PATH`, so `createRequire` resolves `@ramonda/css`
     * from anywhere inside a run of these tests — including from a directory that has nothing. The
     * control passed for the wrong reason until it was moved out here. No editor sets `NODE_PATH`,
     * so this is also the environment the shim really meets.
     */
    function asked(directory: string): {
      said: string[];
      threw?: string;
      service?: string;
      externalFiles?: unknown;
      /** The config keys the project's OWN plugin was handed, when it is the one serving. */
      handed?: string[];
    } {
      execFileSync("node", [join(EXTENSION, "build-plugin.mjs")], { stdio: "pipe" });
      const { NODE_PATH: _hoisted, ...clean } = process.env;
      return JSON.parse(
        execFileSync("node", [join(dirname(fileURLToPath(import.meta.url)), "askTheShim.mjs"), EXTENSION, directory], {
          env: clean,
          encoding: "utf8",
        }),
      );
    }

    test("when the project has one", () => {
      const out = asked(project(`module.exports = () => ({ create: () => ({ marker: "theirs" }) });`));

      expect(out.said.join(" ")).toContain("stands aside");
      expect(out.service).toBe("theirs");
    });

    /**
     * The key the fallback sets is the extension's business, not the project's.
     *
     * It tells the bundled copy that IT is answering for a project that cannot build a block, which
     * is only ever true when the project has no plugin of its own. Handing it to one that does
     * would make it report the opposite of what is true.
     */
    test("and does not hand the project's own plugin the no-compiler key", () => {
      const out = asked(
        project(
          `module.exports = () => ({ create: (info) => ({ marker: "theirs", handed: Object.keys(info.config ?? {}) }) });`,
        ),
      );

      expect(out.handed).toEqual([]);
    });

    /** The control: away from a project that has one, the extension's copy is what runs. */
    test("and runs its own when the project has none", () => {
      const out = asked(mkdtempSync(join(tmpdir(), "ramonda-bare-")));

      expect(out.said.join(" ")).not.toContain("stands aside");
      expect(out.threw).toBeUndefined();
    });

    test("a project plugin that will not start falls back here, and says which copy answered", () => {
      const out = asked(project(`module.exports = () => { throw new Error("no"); };`));

      expect(out.threw).toBeUndefined();
      expect(out.said.join(" ")).toContain("would not start");
      expect(out.said.join(" ")).toContain("using the extension's copy");
    });

    /**
     * A module that is not a factory is treated as ABSENT, not as broken.
     *
     * The `try` around the hand-over would catch calling it anyway, so this is about the message: a
     * package that was never this plugin should not be reported as one that would not start.
     */
    test("a project plugin that is not a factory at all is treated as absent, in silence", () => {
      const out = asked(project(`module.exports = { notAFactory: true };`));

      expect(out.threw).toBeUndefined();
      expect(out.said).toEqual([]);
    });

    /**
     * `getExternalFiles` is asked of the MODULE, so it has to reach the one that served the
     * project. The first version forwarded this copy's, which answers for the wrong plugin the
     * moment a project's own grows the hook.
     */
    test("`getExternalFiles` reaches the module that served the project", () => {
      const out = asked(
        project(
          `module.exports = () => ({ create: () => ({ marker: "theirs" }), getExternalFiles: () => ["theirs.css"] });`,
        ),
      );

      expect(out.externalFiles).toEqual(["theirs.css"]);
    });
  });

  /**
   * The two halves of the no-compiler report, which live in different packages.
   *
   * The shim sets a key on the config it hands the bundled plugin, and the plugin turns that key
   * into a diagnostic — see `plugin.test.ts`. A string written out in both places is a string that
   * can drift, so the shim reads it off the plugin, and this is what says it still can.
   */
  test("the shim and the plugin agree on the key that says nothing here can compile", () => {
    execFileSync("node", [join(EXTENSION, "build-plugin.mjs")], { stdio: "pipe" });
    // By path: the staged package declares only `./plugin`, which is the shim.
    const staged = createRequire(join(EXTENSION, "x.js"))("./node_modules/@ramonda/css/dist/plugin.cjs") as {
      NO_COMPILER?: string;
    };

    expect(staged.NO_COMPILER).toBe(NO_COMPILER);
    expect(readFileSync(join(EXTENSION, "plugin-shim.cjs"), "utf8")).toContain("bundled.NO_COMPILER");
  });

  test("reaches the `.vsix`, which ignores the rest of `node_modules`", () => {
    const ignored = readFileSync(join(EXTENSION, ".vscodeignore"), "utf8");

    expect(ignored).toContain("node_modules/**");
    expect(ignored).toContain("!node_modules/@ramonda/**");
  });
});
