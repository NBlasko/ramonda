import { test, expect, beforeEach } from "vitest";
import { getDOM } from "../../test/setup";
import { created, mounted, destroyed } from "../../base/decorators";
import { Component } from "../../base/Component";
import type { RamondaNode } from "../../types/vdom";

/**
 * What inheritance does to a lifecycle callback, which the documentation makes a claim about.
 *
 * The question these answer: extending a class does NOT make its `@created` run again. A callback
 * belongs to the class that DECLARED it and runs once per instance, however deep the chain is.
 * What "parent-first" describes is the order of DIFFERENT callbacks, not repetitions of one.
 */

let log: string[] = [];
beforeEach(() => {
  log = [];
});

class Base extends Component {
  @created baseCreated() {
    log.push("base:created");
  }
  @mounted baseMounted() {
    log.push("base:mounted");
  }
  @destroyed baseDestroyed() {
    log.push("base:destroyed");
  }
  render(): RamondaNode {
    return <span>base</span>;
  }
}

/** Adds nothing. The interesting case: does `Base`'s callback run twice now? */
class Middle extends Base {}

/** Declares its own, so both should run — parent's first. */
class Leaf extends Middle {
  @created leafCreated() {
    log.push("leaf:created");
  }
  @mounted leafMounted() {
    log.push("leaf:mounted");
  }
}

test("extending a class does not make the parent's @created run again", async () => {
  await getDOM<Middle>(<Middle />);
  // Two levels of inheritance, one declaration, one call.
  expect(log.filter((entry) => entry === "base:created")).toHaveLength(1);
  expect(log).toEqual(["base:created", "base:mounted"]);
});

test("a subclass declaring its own runs both, the parent's first", async () => {
  await getDOM<Leaf>(<Leaf />);
  expect(log).toEqual(["base:created", "leaf:created", "base:mounted", "leaf:mounted"]);
});

test("and each still runs exactly once", async () => {
  await getDOM<Leaf>(<Leaf />);
  for (const entry of new Set(log)) {
    expect(log.filter((seen) => seen === entry)).toHaveLength(1);
  }
});
