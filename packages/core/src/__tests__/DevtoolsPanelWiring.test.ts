import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

/**
 * The panel the entry wires up, which nothing was watching.
 *
 * `index.ts` does three things for the devtools panel inside `if (__DEV__)`, and all three are at
 * module load: it appends `<ramonda-devtools>` once the element is defined, it turns Alt+D into a
 * `ramonda:toggle-devtools` event, and it tries an optional import of `@ramonda/devtools`. The file's
 * own comment records what went wrong once — the append and the shortcut lived inside that import's
 * `.then()`, so an app that imported the panel itself got the logs and no badge.
 *
 * **The order of the tests below is load-bearing.** `src/test/setup.ts` imports the entry (line 5),
 * so the wiring has already run once before any test body starts; the counts here are the counts an
 * app sees. The last test imports the entry a SECOND time, which installs a second keydown listener
 * for the rest of the file — so it has to stay last.
 */
describe("the devtools panel the entry wires up", () => {
  it("has mounted exactly one panel, in the body", () => {
    const panels = document.querySelectorAll("ramonda-devtools");
    expect(panels).toHaveLength(1);
    expect(panels[0]?.parentElement).toBe(document.body);
  });

  it("turns Alt+D into a toggle, and leaves every other key alone", () => {
    let toggles = 0;
    const listener = () => toggles++;
    window.addEventListener("ramonda:toggle-devtools", listener);
    try {
      window.dispatchEvent(new KeyboardEvent("keydown", { altKey: true, code: "KeyD" }));
      expect(toggles).toBe(1);

      // `code`, not `key`: on a Mac Alt+D produces "∂", and a layout that gives another letter
      // still reports KeyD. So the modifier and the physical key are both part of the promise.
      window.dispatchEvent(new KeyboardEvent("keydown", { altKey: false, code: "KeyD" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { altKey: true, code: "KeyE" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { altKey: true, key: "d", code: "" }));
      expect(toggles).toBe(1);
    } finally {
      window.removeEventListener("ramonda:toggle-devtools", listener);
    }
  });

  /**
   * The invariant the runtime cannot show, so it is read off the source.
   *
   * Measured 2026-09-04: `vi.doMock("@ramonda/devtools", …)` never runs — 0 factory calls — because
   * the entry holds the specifier in a VARIABLE, which is deliberate and is what keeps `vite build`
   * working for apps that never installed the panel. `@ramonda/devtools` is also a devDependency
   * here, so in this environment that import RESOLVES: the regression the comment describes would
   * mount the panel anyway and pass every assertion above. That is exactly how it survived being
   * tested the first time.
   *
   * What is checkable is the shape: both the mount and the shortcut come BEFORE the optional import,
   * and nothing inside it does either job.
   */
  it("keeps the mount and the shortcut out of the optional import", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts"), "utf8");

    const mount = source.indexOf('document.body.appendChild(document.createElement("ramonda-devtools"))');
    const shortcut = source.indexOf('window.addEventListener("keydown"');
    const optional = source.indexOf("import(/* @vite-ignore */ devtoolsSpecifier)");

    // A floor under the three needles: a rename that makes one unfindable must fail here rather than
    // pass on -1 < -1 comparisons that happen to hold.
    expect(mount).toBeGreaterThan(-1);
    expect(shortcut).toBeGreaterThan(-1);
    expect(optional).toBeGreaterThan(-1);

    expect(mount).toBeLessThan(optional);
    expect(shortcut).toBeLessThan(optional);

    const afterOptional = source.slice(optional);
    expect(afterOptional).not.toContain("appendChild");
    expect(afterOptional).not.toContain("addEventListener");
  });

  it("does not append a second panel when the entry is loaded again", async () => {
    vi.resetModules();
    await import("../index");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelectorAll("ramonda-devtools")).toHaveLength(1);
  });
});
