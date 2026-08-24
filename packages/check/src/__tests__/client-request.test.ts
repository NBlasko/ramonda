import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const found = () =>
  analyzeProject(join(here, "fixtures", "client-request", "tsconfig.json")).findings["client-only-request-read"];

/**
 * A `requestContext()` read on a path that only runs in the browser, for a value the browser cannot
 * have.
 *
 * The client's request scope carries the live `url`, empty cookies, empty headers, and the values
 * whose keys opted into `exposeToClient` and which the server seeded. So three reads are provably
 * empty there — `cookies`, `headers`, and a key that did not opt in — and a read of one of those
 * from a member that cannot run on the server is certain to find nothing before the app is opened.
 *
 * **A static build will not catch it.** Measured 2026-08-17: a component reading a key in a handler
 * bakes cleanly, `html` present and no `blockedBy`, because the read never runs during the render and
 * the build's per-request poison is never touched. The page ships and the browser reports RMD025.
 * That is the gap this rule closes.
 */
describe("a request read that only ever runs in the browser", () => {
  test("every read that can never find a value is reported, with what it read", () => {
    expect(found().map((issue) => `${issue.component}.${issue.member}: ${issue.read}`)).toEqual([
      "ListenerRead.onClick: requestContext().get(currentUser)",
      "CookieInAnInterval.poll: requestContext().cookies.get(…)",
      "CookieHasOnWindow.onResize: requestContext().cookies.has(…)",
      "HeadersInUpdated.afterCommit: requestContext().headers",
      "ClientOnlyCreated.init: requestContext().get(currentUser)",
      "DeferredRead.wait: requestContext().get(currentUser)",
      "HandlerMethod.save: requestContext().get(currentUser)",
      "InlineHandler.render: requestContext().cookies.get(…)",
      "ExplicitlyNotExposed.onClick: requestContext().get(secret)",
    ]);
  });

  /**
   * The report has to carry both halves of the proof, or a reader cannot check it: why the value can
   * never be there, and why this line only runs where it cannot.
   */
  test("each report names why the value is absent and why the member is client-only", () => {
    const byComponent = new Map(found().map((issue) => [issue.component, issue]));

    expect(byComponent.get("ListenerRead")?.because).toBe("`currentUser` was not declared `{ exposeToClient: true }`");
    expect(byComponent.get("ListenerRead")?.clientOnly).toBe(
      "`@onElement` is an effect, and effects never run on the server",
    );
    expect(byComponent.get("CookieInAnInterval")?.because).toBe("cookies are never sent to the browser");
    expect(byComponent.get("HeadersInUpdated")?.because).toBe("headers are never sent to the browser");
    expect(byComponent.get("ClientOnlyCreated")?.clientOnly).toBe('`@created({ env: "client" })` says so itself');
    expect(byComponent.get("HandlerMethod")?.clientOnly).toBe("It is only ever reached from a JSX event handler");
    expect(byComponent.get("InlineHandler")?.clientOnly).toBe("It is written inside a JSX event attribute");
  });

  /**
   * The silences, and each is a different reason. This is the half that decides whether the rule is
   * usable: reporting `@created` — which defaults to `shared` and is the DOCUMENTED way to read the
   * request — would report the fix as the fault.
   */
  test("the correct arrangements stay silent", () => {
    const reported = new Set(found().map((issue) => issue.component));
    for (const quiet of [
      // `shared` is the default for the lifecycle family, so these run on the server too.
      "SharedCreated",
      "SharedMounted",
      "ServerCreated",
      // The key opted in. Whether the server seeded it is runtime, so nothing is claimed.
      "ExposedKey",
      // `url` is read live from `location` in the browser.
      "UrlInAHandler",
      // `render()` runs on both sides.
      "ReadInRender",
      // One of its callers is a shared lifecycle, so one of them runs on the server.
      "HandlerAlsoCalledOnTheServer",
      // Unresolved is not the same as unexposed.
      "OpaqueKey",
      "App",
    ]) {
      expect(reported.has(quiet), `${quiet} should not be reported`).toBe(false);
    }
  });
});

/**
 * A read narrowed to the SERVER, inside a member only the browser runs.
 *
 * The claim here is that the browser reads a value it does not have. Behind
 * `if (typeof window === "undefined")` it does not read it, so the claim is untrue — the same
 * answer `server-env-in-shared-code` gives to the same guard, through the same `side-guard.ts`,
 * because two rules disagreeing about one `typeof window` is the drift that reader exists to
 * prevent.
 *
 * The argument the other way is real and was weighed: a server guard inside a click handler is DEAD
 * code, so silencing it lets confused code through. It is worth less than the rule staying honest
 * about what it claims, and a checker reporting a line that cannot execute is one people stop
 * believing.
 */
test("a request read narrowed to the server is not reported on a client-only path", () => {
  const found = analyzeProject(join(here, "fixtures", "client-request", "tsconfig.json")).findings[
    "client-only-request-read"
  ];
  expect(found.map((issue) => issue.component)).not.toContain("GuardedInAListener");
  // And the unguarded cookie read two classes below is still reported, so the rule is still on.
  expect(found.map((issue) => issue.component)).toContain("CookieInAnInterval");
});
