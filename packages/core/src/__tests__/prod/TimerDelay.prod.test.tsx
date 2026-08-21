import { describe, expect, test } from "vitest";
import { Component } from "../../base/Component";
import { Interval, Timeout } from "../../base/Timers";
import { getDOM } from "../../test/setup";
import type { RamondaNode } from "../../types/vdom";

/**
 * The delay check on `Timeout` / `Interval` survives a production build, and this is the only run that
 * can see it.
 *
 * ## Why it is not `__DEV__`-only, unlike every other argument check in the package
 *
 * The decorators' copy is guarded, and correctly: `@timeout(3000)` is a literal, so a wrong one is a
 * source mistake the author meets immediately. `after(this.props.backoffMs, run)` is a different thing
 * — the number arrives at runtime, and `undefined` or `NaN` from an API is an ordinary way for it to
 * arrive.
 *
 * Guarded, the two builds would then DISAGREE about that value: development throws, and production
 * hands `NaN` to `setTimeout`, which the spec coerces to `0`. So the retry fires on the next tick and
 * storms — silently, in the only build where it matters. That is the same reason `useCommon`'s `RMD055`
 * throw sits outside its `if (__DEV__)` and `@compute`'s `assertNoParameters` is unguarded.
 *
 * A claim about production belongs in a production run, which is what this file is.
 */

class Retry extends Component {
  timer = this.use(Timeout, () => ({ run: () => {} }));
  beat = this.use(Interval, () => ({ run: () => {} }));

  render(): RamondaNode {
    return <i />;
  }
}

describe("a delay that is not one, in production", () => {
  test("NaN throws instead of becoming a zero-delay timer", async () => {
    const app = await getDOM<Retry>(<Retry />);

    expect(() => app.instance.timer.start(Number.NaN)).toThrow(/\[Timeout\.start\]/);
    // Both classes, because the check lives on the base they share and the message names the subclass.
    expect(() => app.instance.beat.start(Number.NaN)).toThrow(/\[Interval\.start\]/);
    app.unmount();
  });

  test("a delay past what setTimeout can hold throws instead of firing at once", async () => {
    const app = await getDOM<Retry>(<Retry />);

    expect(() => app.instance.timer.start(2_147_483_648)).toThrow(/at most 2147483647 ms/);
    app.unmount();
  });

  test("and a negative one, which the platform treats as zero", async () => {
    const app = await getDOM<Retry>(<Retry />);

    expect(() => app.instance.timer.start(-1)).toThrow(/not be negative/);
    app.unmount();
  });
});
