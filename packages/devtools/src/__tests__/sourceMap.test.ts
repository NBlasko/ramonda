import { describe, expect, it, vi } from "vitest";
import { inlineMap, mapPosition, resolveOriginal } from "../sourceMap";

/**
 * The resolver, tested against maps built here rather than against a fixture, so the expected
 * answers are derived from the encoding rather than copied out of a tool's output.
 *
 * The case that motivated the whole file is the last one: Vite serving a class declared on source
 * line 20 puts it on served line 51, because esbuild lowers standard decorators and prepends a
 * preamble. Thirty-one lines is not a rounding error.
 */

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 VLQ, so a test can state a mapping in numbers and read the answer back. */
function encode(value: number): string {
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) digit |= 32;
    out += BASE64[digit];
  } while (vlq > 0);
  return out;
}

const segment = (...fields: number[]) => fields.map(encode).join("");

describe("mapPosition", () => {
  it("maps a generated line to the original it came from", () => {
    // Generated line 3, column 0 → original line 20, column 8 (both 0-based in the map).
    const mappings = `;;${segment(0, 0, 19, 7)}`;

    expect(mapPosition(mappings, 3, 0)).toEqual({ line: 20, column: 8, sourceIndex: 0 });
  });

  /**
   * Source deltas accumulate across the WHOLE map, not per line — which is why the resolver cannot
   * skip ahead to the line it wants. A test that only ever looked at line one would not notice.
   */
  it("accumulates deltas across lines", () => {
    const mappings = [
      segment(0, 0, 9, 0), // line 1 → original line 10
      segment(0, 0, 5, 2), // line 2 → original line 15
      segment(0, 0, 3, 0), // line 3 → original line 18
    ].join(";");

    expect(mapPosition(mappings, 1, 0)).toMatchObject({ line: 10, column: 1 });
    expect(mapPosition(mappings, 2, 0)).toMatchObject({ line: 15, column: 3 });
    expect(mapPosition(mappings, 3, 0)).toMatchObject({ line: 18, column: 3 });
  });

  it("takes the last segment at or before the column asked for", () => {
    // Two segments on generated line 1: column 0 → original 5, column 10 → original 6.
    const mappings = `${segment(0, 0, 4, 0)},${segment(10, 0, 1, 0)}`;

    expect(mapPosition(mappings, 1, 0)!.line).toBe(5);
    expect(mapPosition(mappings, 1, 9)!.line).toBe(5);
    expect(mapPosition(mappings, 1, 10)!.line).toBe(6);
    expect(mapPosition(mappings, 1, 99)!.line).toBe(6);
  });

  it("says nothing rather than guessing when a line has no mapping", () => {
    expect(mapPosition(`${segment(0, 0, 0, 0)};;`, 2, 0)).toBeUndefined();
    expect(mapPosition("", 4, 0)).toBeUndefined();
  });
});

describe("inlineMap", () => {
  const dataUrl = (mappings: string, sources: string[] = ["App.tsx"]) =>
    `//# sourceMappingURL=data:application/json;base64,${btoa(JSON.stringify({ version: 3, mappings, sources }))}`;

  it("reads the map a dev server appends to the module", () => {
    expect(inlineMap(`const a = 1;\n${dataUrl("AAAA")}`)).toEqual({ mappings: "AAAA", sources: ["App.tsx"] });
  });

  it("returns nothing for a module with no map, or a broken one", () => {
    expect(inlineMap("const a = 1;")).toBeUndefined();
    expect(inlineMap("//# sourceMappingURL=data:application/json;base64,!!!!")).toBeUndefined();
  });
});

describe("resolveOriginal", () => {
  const served = (mappings: string, sources: string[] = ["App.tsx"]) =>
    `class Foo {}\n//# sourceMappingURL=data:application/json;base64,${btoa(
      JSON.stringify({ version: 3, mappings, sources }),
    )}`;

  /**
   * The measured case: a class on source line 20, served on line 51. This is the difference between
   * the button working and the button looking broken.
   */
  it("resolves a decorator-shifted class back to its declaration", async () => {
    const mappings = `${";".repeat(50)}${segment(0, 0, 19, 7)}`;
    vi.stubGlobal("fetch", async () => new Response(served(mappings), { status: 200 }));

    try {
      expect(await resolveOriginal("http://localhost:3000/src/App.tsx?t=1", 51, 1)).toEqual({
        line: 20,
        column: 8,
        // Resolved against the module URL, so a bare basename in the map becomes the real path.
        source: "http://localhost:3000/src/App.tsx",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to the position it was given when there is nothing to resolve with", async () => {
    vi.stubGlobal("fetch", async () => new Response("class Foo {}", { status: 200 }));
    try {
      expect(await resolveOriginal("http://localhost:3000/src/App.tsx", 51, 1)).toEqual({ line: 51, column: 1 });
    } finally {
      vi.unstubAllGlobals();
    }

    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    try {
      expect(await resolveOriginal("http://localhost:3000/src/App.tsx", 7, 2)).toEqual({ line: 7, column: 2 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  /** A Node stack carries a real path, and there is no module to fetch — nothing to resolve. */
  it("does not try to fetch a filesystem path", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      expect(await resolveOriginal("/home/me/app/src/App.tsx", 4, 2)).toEqual({ line: 4, column: 2 });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("a bundled development build", () => {
  /**
   * The module URL is the bundle, and only the map knows which file the code was written in. Without
   * taking the path from the map, the line would be resolved correctly and pointed at the bundle —
   * worse than not resolving at all, because it looks right.
   */
  it("takes the file from the map, not from the module URL", async () => {
    const mappings = `${";".repeat(1200)}${segment(0, 0, 41, 2)}`;
    const map = { version: 3, mappings, sources: ["../src/pages/Products.tsx"] };
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(`bundle\n//# sourceMappingURL=data:application/json;base64,${btoa(JSON.stringify(map))}`, {
          status: 200,
        }),
    );

    try {
      const resolved = await resolveOriginal("http://localhost:5180/assets/client.js", 1201, 1);
      expect(resolved.line).toBe(42);
      expect(resolved.source).toBe("http://localhost:5180/src/pages/Products.tsx");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
