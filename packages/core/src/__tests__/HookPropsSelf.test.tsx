import { describe, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import type { RamondaNode } from "../types/vdom";

/**
 * The props callback's parameter is the OWNER, checked by the compiler.
 *
 * Mostly a compile-time test: it fails by not type-checking, which `pnpm check-types` catches. The
 * `@ts-expect-error` lines are the assertions — each one fails the build if the error it expects
 * stops being reported, which is how a type test says "this is still caught".
 *
 * ## What the parameter is, and why it took three attempts
 *
 * `(bag: never)` was the shape before, and it forced an annotation — `(self: Panel) => …` — because
 * `never` has no members. That worked for the common case and left a hole: `never` accepts ANY
 * function, so a callback written for one class and handed to another passed silently. The failure
 * is a shared callback calling `self.load` on a class with no `load`.
 *
 * A plain `(self: this)` was measured and rejected before this file existed: resolving the overload
 * needs the argument's type, which needs the arrow's contextual type, which needs the class's `this`
 * type — the class whose field is being declared. TS7022 on every call site.
 *
 * `S extends this = this` breaks that circle. `S` is inferred from the callback and only then
 * checked against `this`, so an unannotated parameter is typed, an annotated one is verified, and
 * the field initializer never has to resolve `this` to find the argument's type.
 */

interface Bag {
  fetch: () => string;
}

class Probe extends Hook<Bag> {
  get seen(): string {
    return this.props.fetch();
  }
}

describe("the props callback's parameter", () => {
  test("an unannotated parameter is the owner, and its members are checked", async () => {
    class Panel extends Component {
      load(): string {
        return "loaded";
      }

      // No annotation, and `self.load` resolves — the compiler knows what `self` is.
      probe = this.use(Probe, (self) => ({ fetch: self.load }));

      render(): RamondaNode {
        return <p>{this.probe.seen}</p>;
      }
    }

    const { container } = await getDOM(<Panel />);
    expect(container.textContent).toContain("loaded");
  });

  test("a member that does not exist is caught with no annotation at all", async () => {
    class Panel extends Component {
      // @ts-expect-error — `load` is not on this class, and the compiler says so by name.
      probe = this.use(Probe, (self) => ({ fetch: self.load }));

      render(): RamondaNode {
        return <p>x</p>;
      }
    }

    // The class still runs; the assertion above is the point.
    expect(typeof Panel).toBe("function");
  });

  test("a callback written for another class is refused", async () => {
    class HasLoad extends Component {
      load(): string {
        return "x";
      }
      render(): RamondaNode {
        return <p>x</p>;
      }
    }

    /** Written once, meant to be reused — the case that used to pass silently. */
    const shared = (self: HasLoad) => ({ fetch: self.load });

    class Other extends Component {
      // @ts-expect-error — `Other` is not a `HasLoad`, so this callback does not fit it.
      probe = this.use(Probe, shared);

      render(): RamondaNode {
        return <p>x</p>;
      }
    }

    expect(typeof Other).toBe("function");
  });

  test("an explicit annotation still works when it is right", async () => {
    class Panel extends Component {
      load(): string {
        return "annotated";
      }

      probe = this.use(Probe, (self: Panel) => ({ fetch: self.load }));

      render(): RamondaNode {
        return <p>{this.probe.seen}</p>;
      }
    }

    const { container } = await getDOM(<Panel />);
    expect(container.textContent).toContain("annotated");
  });

  test("`this` instead of a parameter is unaffected", async () => {
    class Panel extends Component {
      load(): string {
        return "via this";
      }

      probe = this.use(Probe, () => ({ fetch: this.load }));

      render(): RamondaNode {
        return <p>{this.probe.seen}</p>;
      }
    }

    const { container } = await getDOM(<Panel />);
    expect(container.textContent).toContain("via this");
  });

  test("a hook using a hook gets the same checking", async () => {
    class Parent extends Hook {
      label(): string {
        return "from a hook";
      }

      child = this.use(Probe, (self) => ({ fetch: self.label }));
    }

    class Page extends Component {
      parent = this.use(Parent);

      render(): RamondaNode {
        return <p>{this.parent.child.seen}</p>;
      }
    }

    const { container } = await getDOM(<Page />);
    expect(container.textContent).toContain("from a hook");
  });
});
