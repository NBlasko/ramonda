import type { BaseComponent, RamondaNode } from "../types/vdom";
import { GLOBAL_RUNTIME } from "../core/runtime";
import { displayName, isArray } from "./utils";
import { HAS_REGION, COMPONENT_TYPE } from "./constants";
import { isListNode, isVNode } from "../vdom/guards";
import { renderPhase } from "../debug/renderPhase";
import { checkRenderStability, isStrictRender } from "../debug/renderStability";
import { currentOrigin } from "../core/origin";
import { diagnose } from "../debug/diagnostics";

export function generateRenderOutput(component: BaseComponent) {
  if (__DEV__) {
    // render() is the one moment no signal setter may fire. Mark who is
    // rendering so State.set can report the write (RMD001).
    renderPhase.component = component;
    try {
      const output = buildRenderOutput(component);

      // Rendered a SECOND time, and the second output thrown away, so anything that
      // differs between them can be named: an inline handler, a rebuilt object, a
      // value that does not come from state. Two calls in the same tick cannot
      // confuse "created in place" with "genuinely changed" — see RMD020, and
      // `debug/renderStability.ts` for what this costs (3-4% of a commit) and why
      // discarding the second output is safe.
      if (isStrictRender()) {
        checkRenderStability(component, output, buildRenderOutput(component));
      }

      return output;
    } finally {
      renderPhase.component = undefined;
    }
  }

  return buildRenderOutput(component);
}

/**
 * Says so when `render()` returned a promise, which is the one thing it may never do.
 *
 * Dev-only: the check costs one property read on the value the render just returned, and production
 * keeps the behaviour it always had.
 */
function reportIfAsync(output: unknown, component: BaseComponent): void {
  if (typeof (output as { then?: unknown })?.then !== "function") return;

  const name = displayName(component as object);
  diagnose("RMD060", name, `<${name} />'s \`render()\` is async — it returns a promise, not markup.`, {
    component: name,
  });
}

function buildRenderOutput(component: BaseComponent) {
  // Everything render() builds is stamped with this component, so the diff can
  // tell a component's own elements from ones handed to it through a prop.
  // Saved and restored rather than cleared: a hook getter runs inside here, and
  // a list must carry its owner.
  const previousOrigin = currentOrigin.id;
  currentOrigin.id = component[GLOBAL_RUNTIME].id;

  let innerRendered: RamondaNode;
  try {
    innerRendered = (component as Required<BaseComponent>).render();
  } finally {
    currentOrigin.id = previousOrigin;
  }

  // Asked of what `render()` returned, which is the value itself: there is no wrapper between it
  // and the caller, so a promise is visible here and nowhere else.
  if (__DEV__) reportIfAsync(innerRendered, component);

  /**
   * The children ARE the output. There is no wrapper.
   *
   * A component owns a range of its parent's children, so what `render()` returned goes straight
   * into the parent — one node, two, or none. The parent's record is what says which of them are
   * this component's, and `ComponentRegion` is that entry.
   *
   * Nothing is derived from the class here any more: there is no tag to resolve, no `style` to
   * default, no attribute bag, and no `key` to copy onto an element — the parent reads `key` off
   * the vnode when it builds the region, which is the only place it was ever needed.
   */
  const children = isArray(innerRendered) ? innerRendered : [innerRendered];

  // render()'s output goes to the parent directly — it never passes through flattenMixedArray,
  // which is where the marker is normally set. Without this, a list or a component returned
  // straight from render() would reach the diff unmarked and be reconciled as if it were a single
  // node. The scan is over the render's own children only, which is one item in the overwhelming
  // majority of components.
  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    // A component child owns a range of its own, so this render's own record has to exist.
    if (isVNode(child) && child.type === COMPONENT_TYPE) {
      (children as { [HAS_REGION]?: boolean })[HAS_REGION] = true;
      continue;
    }

    if (isListNode(child)) {
      (children as { [HAS_REGION]?: boolean })[HAS_REGION] = true;

      // A `list()` descriptor returned STRAIGHT from render() — `return
      // list({...})` rather than `<ul>{list({...})}</ul>` — has no owner yet,
      // because only `normalizeChildren` stamps one and this path never goes
      // through it. Without this the region has an undefined identity: it
      // matches every other ownerless region, and its unbuilt `vnodes` reach
      // the reorder pass. Measured as `insertBefore: parameter 1 is not of type
      // 'Node'` — a crash, not a wrong render.
      //
      // Same composite identity `normalizeChildren` uses — origin plus position.
      //
      // Read from the COMPONENT rather than from `currentOrigin`, which by this
      // line has already been restored: the try/finally above puts back the
      // previous origin as soon as `render()` returns, and this runs after it.
      // The id it used to read was therefore never this component's — it was
      // whatever was on the stack outside, which is always 0, because a build is
      // never entered while another render is in progress. Stable and unique per
      // host, so nothing ever misbehaved; it simply was not the identity the
      // comment claimed, and `h.ts` stamps the live origin — the component's id —
      // for the wrapped `<ul>{list()}</ul>` form. Now the two agree.
      // As in `h.ts`: the cast defeats `readonly` and nothing else, because this
      // and that one are the only two lines allowed to stamp an owner.
      if (child.owner === undefined) (child as { owner: unknown }).owner = `${component[GLOBAL_RUNTIME].id}:g${i}`;
      // No `break`: with several lists each needs its own position.
    }
  }

  return children;
}
