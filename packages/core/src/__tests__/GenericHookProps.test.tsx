/**
 * The tripwire for `use`'s overload shape.
 *
 * A GENERIC hook class — `Query<TData>` in `@ramonda/query` is the case that
 * motivated it — has no fixed candidate for its props type, so `Q` has to be
 * inferred from the props callback's RETURN type. That only works while the
 * callback lives in its own overload; folded into one union parameter
 * (`props: Q | R`), TypeScript infers `Q` as the callback itself, because a
 * function is assignable to `Record<string, any>`. See `PropsFactory` in
 * types/HookTypes.ts for the full measurement.
 *
 * Most of this file is therefore a COMPILE-time test: it fails by not
 * type-checking, which `pnpm check-types` catches. The runtime assertions below
 * only prove the inferred props actually arrive.
 */
import { describe, expect, test } from "vitest";
import { Component, Hook, bootstrap, state, unmount } from "../index";
import type { RamondaNode, VNode } from "../types/vdom";

interface Loaded {
  name: string;
  hits: number;
}

interface ResourceProps<TData> {
  from: string;
  load: () => TData;
}

/** Stands in for `Query<TData>`: generic, with the data type only in a prop. */
class Resource<TData> extends Hook<ResourceProps<TData>> {
  @state private version = 0;

  get data(): TData {
    // Read so the field is not merely decorative — this is the shape a real
    // observer has, where a counter is what schedules the owner's re-render.
    void this.version;
    return this.props.load();
  }

  get from(): string {
    return this.props.from;
  }
}

class Consumer extends Component<{ id: string }> {
  private resource = this.use(Resource, (self: Consumer) => ({
    from: `/api/thing/${self.props.id}`,
    load: (): Loaded => ({ name: `thing-${self.props.id}`, hits: 1 }),
  }));

  /**
   * The compile-time assertion, and it is the point of the file: annotated as
   * `Loaded`, so a `TData` that came out as `unknown` (the pre-overload
   * behaviour) fails to type-check here rather than silently widening.
   */
  get loaded(): Loaded {
    return this.resource.data;
  }

  render(): RamondaNode {
    return (
      <div id="out">
        {this.loaded.name}@{this.resource.from}
      </div>
    );
  }
}

/** The plain-object form must keep working, and keep inferring. */
class ObjectPropsConsumer extends Component {
  private resource = this.use(Resource, {
    from: "/fixed",
    load: (): Loaded => ({ name: "fixed", hits: 7 }),
  });

  get loaded(): Loaded {
    return this.resource.data;
  }

  render(): RamondaNode {
    return <div id="fixed">{String(this.loaded.hits)}</div>;
  }
}

function withApp(vnode: VNode, body: (container: HTMLElement) => void) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  bootstrap(vnode, container);
  try {
    body(container);
  } finally {
    unmount(container);
    container.remove();
  }
}

describe("a generic hook's props", () => {
  test("the hook's type parameter is inferred from the props callback", () => {
    withApp((<Consumer id="42" />) as VNode, (container) => {
      expect(container.querySelector("#out")!.textContent).toBe("thing-42@/api/thing/42");
    });
  });

  test("and from a plain props object too", () => {
    withApp((<ObjectPropsConsumer />) as VNode, (container) => {
      expect(container.querySelector("#fixed")!.textContent).toBe("7");
    });
  });
});
