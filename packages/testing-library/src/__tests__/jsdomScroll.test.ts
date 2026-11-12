import { describe, expect, test, vi } from "vitest";
import "../index";

/**
 * jsdom has no layout, so its `scrollTo` prints "Not implemented: window.scrollTo" — once per router
 * navigation, since a `push` scrolls to the top. Found by the second trial: every test that navigated
 * printed it, a line of noise in every run that said nothing about the app.
 */
describe("scrolling in jsdom", () => {
  test("says nothing", () => {
    const said: string[] = [];
    const spies = (["error", "warn", "log", "info"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation((...args: unknown[]) => void said.push(args.map(String).join(" "))),
    );
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      said.push(String(chunk));
      return true;
    });
    try {
      window.scrollTo(0, 0);
      window.scrollTo({ top: 0 });
    } finally {
      for (const spy of spies) spy.mockRestore();
      stderr.mockRestore();
    }
    expect(said.join(" ")).not.toContain("Not implemented");
  });
});
