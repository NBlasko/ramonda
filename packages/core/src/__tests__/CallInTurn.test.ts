import { describe, expect, test } from "vitest";
import { callInTurn } from "../core/field";

/**
 * A field's own handlers, called in turn as listeners on one element are: one that stops the event
 * for the rest is the last. What is asked here is the event itself — what the call leaves on it.
 */
describe("handlers called in turn", () => {
  test("a turn inside another leaves the outer one hearing its stop", () => {
    const called: string[] = [];
    const event = new Event("input");
    callInTurn(
      [
        () => callInTurn([() => called.push("inner a"), () => called.push("inner b")], event),
        (seen: Event) => {
          called.push("stops");
          seen.stopImmediatePropagation();
        },
        () => called.push("after the stop"),
      ],
      event,
    );

    expect(called).toEqual(["inner a", "inner b", "stops"]);
  });

  test("a method the event carried as its own is its own again after", () => {
    const event = new Event("input");
    const own = () => {};
    Object.defineProperty(event, "stopImmediatePropagation", { configurable: true, writable: true, value: own });
    callInTurn([() => {}, () => {}], event);

    expect(Object.getOwnPropertyDescriptor(event, "stopImmediatePropagation")?.value).toBe(own);
  });

  test("one handler is handed the event as it is", () => {
    const touched: boolean[] = [];
    const event = new Event("input");
    callInTurn([undefined, (seen: Event) => touched.push(Object.hasOwn(seen, "stopImmediatePropagation"))], event);

    expect(touched).toEqual([false]);
  });
});
