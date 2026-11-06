import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Component, configureDev } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { allowDiagnostics, render } from "../index";
import { diagnosticsFailure, startTest } from "../diagnostics";

/**
 * A development diagnostic fails the test it happened in.
 *
 * Found by an agent building an app from the docs alone: RMD020, RMD022 and RMD047 were all printed
 * while its tests ran, every test passed, and the runner hides a passing test's console. It saw RMD020
 * only in the browser — and one of the three was a real bug in its own harness.
 *
 * The check runs after each test on its own, the way `cleanup` does. These tests call the same
 * function the hook calls, which also takes what they caused, so the hook finds nothing afterwards.
 */
class Rebuilds extends Component {
  render(): RamondaNode {
    // A new object on every render, with the same contents: RMD020, a warning.
    return <p data-conf={{ size: 1 } as never}>x</p>;
  }
}

beforeEach(() => configureDev({ strictRender: true }));
afterEach(() => configureDev({ strictRender: false }));

describe("a diagnostic during a test", () => {
  test("is a failure that names it and says what to do", () => {
    render(<Rebuilds />);
    const failure = diagnosticsFailure();
    expect(failure?.message).toContain("RMD020");
    expect(failure?.message).toContain('allowDiagnostics("RMD020")');
    // Taken: the hook after this test finds nothing more.
    expect(diagnosticsFailure()).toBeUndefined();
  });

  test("is reported again in the next test — one test's report does not hide another's", () => {
    render(<Rebuilds />);
    expect(diagnosticsFailure()?.message).toContain("RMD020");
  });

  test("is let through when the test allows that code, and only that one", () => {
    allowDiagnostics("RMD020");
    render(<Rebuilds />);
    expect(diagnosticsFailure()).toBeUndefined();

    globalThis.__RAMONDA_DIAGNOSTICS__?.({
      code: "RMD999",
      scope: "ramonda/core",
      severity: "warn",
      message: "another",
      time: 0,
    } as never);
    expect(diagnosticsFailure()?.message).toContain("RMD999");
  });
});

/**
 * Every package that says a diagnostic once per process hands over a way to forget, in ONE global set,
 * the way every package reports through one global sink. Core's was reached through a seam and
 * `@ramonda/query`'s through nothing, so the second test to repeat a query mistake passed in silence.
 * Found by a review of this branch.
 */
describe("before each test", () => {
  test("every package's record of what it already said is forgotten", () => {
    let forgotten = 0;
    const forget = () => {
      forgotten++;
    };
    (globalThis.__RAMONDA_DIAGNOSTICS_RESET__ ??= new Set()).add(forget);
    try {
      startTest();
      expect(forgotten).toBe(1);
    } finally {
      globalThis.__RAMONDA_DIAGNOSTICS_RESET__?.delete(forget);
    }
  });

  /**
   * A test that installs a collector of its own and clears it afterwards — the usual pattern in this
   * repository's tests — replaced the harness's collector, and nothing put it back: every later test
   * in the file passed whatever it reported. Found by the final review.
   */
  test("the harness's own collector is put back if a test took it away", () => {
    globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
    startTest();
    // Read back through a cast: after `= undefined` the checker narrows the global to that.
    const sink = globalThis.__RAMONDA_DIAGNOSTICS__ as ((record: never) => void) | undefined;
    sink?.({ code: "RMD998", scope: "ramonda/core", severity: "warn", time: 0 } as never);
    expect(diagnosticsFailure()?.message).toContain("RMD998");
  });

  test("core's own is one of them", () => {
    expect(globalThis.__RAMONDA_DIAGNOSTICS_RESET__?.size ?? 0).toBeGreaterThan(0);
  });
});

describe("what is not a failure", () => {
  test("a diagnostic that was thrown as well — the test already saw the throw", () => {
    globalThis.__RAMONDA_DIAGNOSTICS__?.({
      code: "RMF001",
      scope: "ramonda/form",
      severity: "error",
      thrown: true,
      time: 0,
    } as never);
    expect(diagnosticsFailure()).toBeUndefined();
  });

  test("a record from outside Ramonda, and a debug record from inside it", () => {
    globalThis.__RAMONDA_DIAGNOSTICS__?.({ code: "X1", scope: "someone-else", severity: "error", time: 0 } as never);
    globalThis.__RAMONDA_DIAGNOSTICS__?.({
      code: "selftest",
      scope: "ramonda/devtools",
      severity: "debug",
      time: 0,
    } as never);
    expect(diagnosticsFailure()).toBeUndefined();
  });

  test("a clean render", () => {
    class Clean extends Component {
      render(): RamondaNode {
        return <p>x</p>;
      }
    }
    render(<Clean />);
    expect(diagnosticsFailure()).toBeUndefined();
  });
});

/**
 * The hook itself, which the tests above cannot see: they take what they caused, so the check after
 * each of them finds nothing. Only a run of its own can watch a test fail, so `fixtures/diagnostics`
 * is run in a vitest of its own — one test that causes RMD020, one that checks it left nothing
 * mounted behind, and one that allows it.
 */
describe("after each test, on its own", () => {
  test("fails the test that caused one, and passes the test that allowed it", () => {
    const HERE = import.meta.url;
    const pkg = fileURLToPath(new URL("../..", HERE));
    const run = spawnSync("pnpm", ["exec", "vitest", "run", "--config", "vitest.fixtures.config.ts"], {
      cwd: pkg,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    const out = `${run.stdout}${run.stderr}`;
    expect(run.status).not.toBe(0);
    expect(out).toMatch(/1 failed \| 2 passed/);
    expect(out).toContain('allowDiagnostics("RMD020")');
  }, 60_000);
});
