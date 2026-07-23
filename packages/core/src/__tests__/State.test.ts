import { describe, test, expect, vi } from "vitest";
import { State } from "../reactivity/State";
import { attach, detach } from "../helpers/constants";

/**
 * State stores its first listener in a plain slot and only allocates a Map when
 * a second one arrives. That upgrade is invisible from outside, so these lock
 * down that both storage modes behave identically.
 */
describe("State: listener storage", () => {
  test("constructs without options", () => {
    const signal = new State(1);
    expect(signal.get()).toBe(1);
    signal.set(2);
    expect(signal.get()).toBe(2);
  });

  test("notifies a single listener", () => {
    const onChange = vi.fn();
    const signal = new State(0, { listener: { id: 1, onChange } });

    signal.set(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("notifies every listener after the upgrade to a Map", () => {
    const first = vi.fn();
    const second = vi.fn();
    const third = vi.fn();

    const signal = new State(0, { listener: { id: 1, onChange: first } });
    signal[attach]({ id: 2, onChange: second });
    signal[attach]({ id: 3, onChange: third });

    signal.set(1);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(third).toHaveBeenCalledTimes(1);
  });

  test("attaching the same id twice replaces, never duplicates", () => {
    const original = vi.fn();
    const replacement = vi.fn();

    const signal = new State(0, { listener: { id: 1, onChange: original } });
    signal[attach]({ id: 1, onChange: replacement });

    signal.set(1);

    expect(original).not.toHaveBeenCalled();
    expect(replacement).toHaveBeenCalledTimes(1);
  });

  test("attaching the same id twice replaces once upgraded too", () => {
    const first = vi.fn();
    const second = vi.fn();
    const replacement = vi.fn();

    const signal = new State(0, { listener: { id: 1, onChange: first } });
    signal[attach]({ id: 2, onChange: second });
    signal[attach]({ id: 2, onChange: replacement });

    signal.set(1);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(replacement).toHaveBeenCalledTimes(1);
  });

  test("detaches the only listener", () => {
    const onChange = vi.fn();
    const signal = new State(0, { listener: { id: 1, onChange } });

    signal[detach](1);
    signal.set(1);

    expect(onChange).not.toHaveBeenCalled();
  });

  test("detaching an unknown id leaves the listener alone", () => {
    const onChange = vi.fn();
    const signal = new State(0, { listener: { id: 1, onChange } });

    signal[detach](99);
    signal.set(1);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("detaches one of many", () => {
    const first = vi.fn();
    const second = vi.fn();

    const signal = new State(0, { listener: { id: 1, onChange: first } });
    signal[attach]({ id: 2, onChange: second });
    signal[detach](1);

    signal.set(1);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("re-attaching after a full detach still notifies", () => {
    const onChange = vi.fn();
    const signal = new State(0, { listener: { id: 1, onChange } });

    signal[detach](1);
    signal[attach]({ id: 1, onChange });
    signal.set(1);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("a listener that detaches itself mid-notify does not break the rest", () => {
    const signal = new State(0, { listener: { id: 1, onChange: () => {} } });
    const second = vi.fn();

    signal[attach]({
      id: 2,
      onChange: () => {
        signal[detach](2);
      },
    });
    signal[attach]({ id: 3, onChange: second });

    expect(() => {
      signal.set(1);
    }).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);

    // The self-detach took effect for the next round.
    second.mockClear();
    signal.set(2);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("State: update semantics", () => {
  test("does not notify when shouldUpdate rejects the write", () => {
    const onChange = vi.fn();
    const signal = new State(5, { listener: { id: 1, onChange } });

    signal.set(5);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("a change of type is a change", () => {
    // Loose `!=` coerces, so `0 != "0"` is false and the write would be
    // dropped: the value changes but nothing re-renders.
    const onChange = vi.fn();
    const signal = new State<unknown>(0, { listener: { id: 1, onChange } });

    signal.set("0");

    expect(signal.get()).toBe("0");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["number to numeric string", 0, "0"],
    ["empty string to zero", "", 0],
    ["zero to false", 0, false],
    ["one to true", 1, true],
    ["null to undefined", null, undefined],
  ])("notifies on %s", (_label, prev, next) => {
    const onChange = vi.fn();
    const signal = new State<unknown>(prev, { listener: { id: 1, onChange } });

    signal.set(next);

    expect(signal.get()).toBe(next);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("honours a custom shouldUpdate", () => {
    const onChange = vi.fn();
    const signal = new State(0, {
      listener: { id: 1, onChange },
      shouldUpdate: (prev, next) => Math.abs(next - prev) > 10,
    });

    signal.set(5);
    expect(onChange).not.toHaveBeenCalled();
    expect(signal.get()).toBe(0);

    signal.set(20);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(signal.get()).toBe(20);
  });

  test("get reads back what set wrote", () => {
    const signal = new State("a");

    signal.set("b");
    expect(signal.get()).toBe("b");

    signal.set("c");
    expect(signal.get()).toBe("c");
  });
});
