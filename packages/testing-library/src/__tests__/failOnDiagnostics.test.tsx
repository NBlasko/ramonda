import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Component, configureDev } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { allowDiagnostics, render } from "../index";
import { diagnosticsFailure } from "../diagnostics";

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

describe("what is not a failure", () => {
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
