import { beforeEach, describe, expect, test, vi } from "vitest";
import { hashKey, keyStartsWith, resetKeyDiagnostics, sameKeyParts } from "../hashKey";

beforeEach(() => {
  resetKeyDiagnostics();
});

describe("hashKey", () => {
  test("two keys equal by value hash the same", () => {
    expect(hashKey(["user", 1])).toBe(hashKey(["user", 1]));
  });

  test("object key order does not split one query into two entries", () => {
    // The failure this prevents: the server hashes one order, the client the
    // other, the restored data is never found, and every query refetches.
    expect(hashKey(["posts", { page: 1, tag: "a" }])).toBe(hashKey(["posts", { tag: "a", page: 1 }]));
  });

  test("nested objects are sorted too", () => {
    expect(hashKey([{ a: { y: 1, x: 2 } }])).toBe(hashKey([{ a: { x: 2, y: 1 } }]));
  });

  test("different keys hash differently", () => {
    expect(hashKey(["user", 1])).not.toBe(hashKey(["user", 2]));
    expect(hashKey(["user", 1])).not.toBe(hashKey(["users", 1]));
    // Order within the ARRAY is identity, unlike order within an object.
    expect(hashKey([1, "a"])).not.toBe(hashKey(["a", 1]));
  });

  test("null, undefined and false are told apart", () => {
    const hashes = new Set([hashKey([null]), hashKey([undefined]), hashKey([false]), hashKey([0]), hashKey([""])]);
    expect(hashes.size).toBe(5);
  });

  test("a function in a key is reported (RMQ001)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      hashKey(["user", () => 1]);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("RMQ001"));
    } finally {
      error.mockRestore();
    }
  });

  test("a Date in a key is reported (RMQ001)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      hashKey(["day", new Date(0)]);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("RMQ001"));
    } finally {
      error.mockRestore();
    }
  });

  test("the report is deduped — one bad key shape is one problem", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      hashKey(["a", () => 1]);
      hashKey(["b", () => 2]);
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
    }
  });
});

describe("sameKeyParts", () => {
  test("a rebuilt array of the same primitives is recognised without hashing", () => {
    // The whole point: this is what a props callback produces on every render, and
    // answering it must not cost a JSON.stringify.
    expect(sameKeyParts(["user", 42], ["user", 42])).toBe(true);
    expect(sameKeyParts(["a", "b", 1, true, 99], ["a", "b", 1, true, 99])).toBe(true);
  });

  test("the same array is trivially the same", () => {
    const key = ["user", 1];
    expect(sameKeyParts(key, key)).toBe(true);
  });

  test("a different part, a different length, a different order — all no", () => {
    expect(sameKeyParts(["user", 1], ["user", 2])).toBe(false);
    expect(sameKeyParts(["user", 1], ["user"])).toBe(false);
    expect(sameKeyParts([1, "a"], ["a", 1])).toBe(false);
  });

  test("it says no for equal-by-value objects — that is what the hash is for", () => {
    // Deliberately asserted: this function only ever answers "definitely the same".
    // A `false` here sends the caller to `hashKey`, which decides.
    expect(sameKeyParts(["posts", { page: 1 }], ["posts", { page: 1 }])).toBe(false);
    expect(hashKey(["posts", { page: 1 }])).toBe(hashKey(["posts", { page: 1 }]));
  });

  test("NaN matches itself and -0 does not match 0", () => {
    // `Object.is`, not `===`. A key part of NaN would otherwise look changed on every
    // render, and 0 / -0 hash differently, so treating them as equal here would
    // disagree with the cache.
    expect(sameKeyParts([Number.NaN], [Number.NaN])).toBe(true);
    expect(sameKeyParts([0], [-0])).toBe(false);
  });

  test("undefined and null are told apart, like the hash tells them apart", () => {
    expect(sameKeyParts([undefined], [null])).toBe(false);
    expect(hashKey([undefined])).not.toBe(hashKey([null]));
  });
});

describe("keyStartsWith", () => {
  test("a prefix reaches every key under it", () => {
    expect(keyStartsWith(["user", 1], ["user"])).toBe(true);
    expect(keyStartsWith(["user", 1, "posts"], ["user", 1])).toBe(true);
  });

  test("it does not reach a sibling", () => {
    expect(keyStartsWith(["posts", 1], ["user"])).toBe(false);
    expect(keyStartsWith(["user", 2], ["user", 1])).toBe(false);
  });

  test("a prefix longer than the key matches nothing", () => {
    expect(keyStartsWith(["user"], ["user", 1])).toBe(false);
  });

  test("an object in the prefix matches by value, not identity", () => {
    // A component builds the literal fresh on every render, so `===` would match
    // nothing at all.
    expect(keyStartsWith(["posts", { page: 1 }], ["posts", { page: 1 }])).toBe(true);
  });

  test("the empty prefix matches everything — that is `invalidate()`", () => {
    expect(keyStartsWith(["anything", 3], [])).toBe(true);
  });
});
