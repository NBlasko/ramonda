import { describe, expect, test } from "vitest";
import { Component } from "../../base/Component";
import { state, created, mounted } from "../../base/decorators";
import { renderToString } from "../../hydration/ssr";
import { requestContext, requestKey } from "../../hydration/requestContext";

/**
 * Can `requestContext()` hand one visitor another visitor's data?
 *
 * The scope is a MODULE-LEVEL `let` (`hydration/requestContext.ts`), so on a server handling
 * two requests at once the question is not theoretical. What makes it safe is not the variable
 * but the WINDOW: `renderToString` sets the scope, mounts synchronously, and clears it in a
 * `finally` before its first `await`. Node runs that section to completion — a microtask cannot
 * interrupt it — so no second request can be inside it at the same time.
 *
 * These are the tests that would fail if that window ever grew.
 */

const currentUser = requestKey<string>("concurrentUser");

function request(user: string) {
  return { url: new URL(`https://example.com/${user}`), values: new Map([[currentUser, user] as const]) };
}

describe("two requests rendering at once", () => {
  test("each synchronous read sees its OWN request", async () => {
    class Who extends Component {
      render() {
        return (
          <main>
            <p>{requestContext().get(currentUser)}</p>
          </main>
        );
      }
    }

    // Started together and deliberately NOT awaited in turn: both are in flight before either
    // resolves, which is the shape a server under load has.
    const [ada, bob] = await Promise.all([
      renderToString(<Who />, { request: request("ada") }),
      renderToString(<Who />, { request: request("bob") }),
    ]);

    expect(ada).toContain("ada");
    expect(ada).not.toContain("bob");
    expect(bob).toContain("bob");
    expect(bob).not.toContain("ada");
  });

  test("a read in @created sees its own request, with ten renders interleaved", async () => {
    class Who extends Component {
      @state seen = "";
      @created init() {
        this.seen = requestContext().get(currentUser);
      }
      render() {
        return (
          <main>
            <p>{this.seen}</p>
          </main>
        );
      }
    }

    const users = Array.from({ length: 10 }, (_, i) => `user${i}`);
    const html = await Promise.all(users.map((user) => renderToString(<Who />, { request: request(user) })));

    users.forEach((user, i) => {
      expect(html[i]).toContain(`>${user}<`);
      // Nobody else's name anywhere in this page.
      for (const other of users) {
        if (other !== user) expect(html[i]).not.toContain(`>${other}<`);
      }
    });
  });

  test("a read AFTER an await throws — it does not silently answer with another request", async () => {
    const outcomes: string[] = [];

    class Late extends Component {
      @mounted async late() {
        await Promise.resolve();
        try {
          outcomes.push(`read:${requestContext().get(currentUser)}`);
        } catch (error) {
          outcomes.push(`threw:${(error as Error).message.slice(0, 40)}`);
        }
      }
      render() {
        return (
          <main>
            <p>late</p>
          </main>
        );
      }
    }

    await Promise.all([
      renderToString(<Late />, { request: request("ada") }),
      renderToString(<Late />, { request: request("bob") }),
    ]);

    // The documented rule is "read synchronously". What matters for SAFETY is that breaking it
    // is loud: every outcome is a throw, and no outcome is another visitor's name.
    expect(outcomes).toHaveLength(2);
    for (const outcome of outcomes) {
      expect(outcome.startsWith("threw:")).toBe(true);
    }
  });

  test("an ASYNC @created is safe before its await and loud after it", async () => {
    // `@created` is where the docs send people, so the trap is writing `async` on it and
    // reading below the first `await` — still inside the method that is documented as safe.
    const early: string[] = [];
    const late: string[] = [];

    class Both extends Component {
      @created async init() {
        early.push(requestContext().get(currentUser));
        await Promise.resolve();
        try {
          late.push(`read:${requestContext().get(currentUser)}`);
        } catch {
          late.push("threw");
        }
      }
      render() {
        return (
          <main>
            <p>both</p>
          </main>
        );
      }
    }

    await Promise.all([
      renderToString(<Both />, { request: request("ada") }),
      renderToString(<Both />, { request: request("bob") }),
    ]);

    // Above the await both requests answered themselves; below it neither answered at all.
    expect([...early].sort()).toEqual(["ada", "bob"]);
    expect(late).toEqual(["threw", "threw"]);
  });

  test("an UNCAUGHT late read still reports RMD053, because the throw itself goes nowhere", async () => {
    // The measurement this test exists for: with no try/catch, `renderToString` resolves,
    // the page is served, and the rejection is swallowed by the drain's allSettled. The
    // record is the only thing that survives that — the same reasoning `guardBuild` uses
    // for build mode, which records on the scope IN ADDITION to throwing.
    // Its own key: `diagnose` dedups on code + field for the whole module, and the tests above
    // have already spent `get("concurrentUser")`. A shared key would make this pass or fail on
    // test ORDER, which is not what it is asserting.
    const uncaughtUser = requestKey<string>("uncaughtUser");
    const records: { code: string; data: unknown }[] = [];
    const previous = globalThis.__RAMONDA_DIAGNOSTICS__;
    globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push({ code: record.code, data: record.data });

    let reached: string | undefined;

    class Uncaught extends Component {
      @mounted async late() {
        await Promise.resolve();
        // Exactly what an app would write — no guard around it.
        reached = requestContext().get(uncaughtUser);
      }
      render() {
        return (
          <main>
            <p>page</p>
          </main>
        );
      }
    }

    const html = await renderToString(<Uncaught />, {
      request: { url: new URL("https://example.com/"), values: new Map([[uncaughtUser, "ada"] as const]) },
    });
    globalThis.__RAMONDA_DIAGNOSTICS__ = previous;

    // The page is served regardless, which is the part that makes silence dangerous, and the
    // line below the await never completed.
    expect(html).toContain("page");
    expect(reached).toBeUndefined();

    const reported = records.filter((record) => record.code === "RMD053");
    expect(reported).toHaveLength(1);
    expect(reported[0].data).toEqual({ field: 'get("uncaughtUser")' });
  });

  test("the object requestContext() returns is not a snapshot, and reads late through it also throw", async () => {
    const outcomes: string[] = [];

    class Held extends Component {
      // Taken during the synchronous section — legal — and used after a yield, which is not.
      // Every member is a getter over the module scope, so the object carries no request of its own.
      context = requestContext();

      @mounted async late() {
        await Promise.resolve();
        try {
          outcomes.push(`read:${this.context.get(currentUser)}`);
        } catch (error) {
          outcomes.push(`threw:${(error as Error).name}`);
        }
      }
      render() {
        return (
          <main>
            <p>held</p>
          </main>
        );
      }
    }

    await Promise.all([
      renderToString(<Held />, { request: request("ada") }),
      renderToString(<Held />, { request: request("bob") }),
    ]);

    expect(outcomes).toHaveLength(2);
    for (const outcome of outcomes) {
      expect(outcome.startsWith("threw:")).toBe(true);
    }
  });
});
