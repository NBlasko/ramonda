import type { BaseComponent, RamondaNode } from "../types/vdom";
import { GLOBAL_RUNTIME } from "../core/runtime";
import { displayName, isArray } from "./utils";
import { normalizeChildren } from "../vdom/h";
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
   * A promise is handed on RAW, so the diff still throws over it.
   *
   * `normalizeChildren` treats an object that is not a vnode as a mistake to report and drop —
   * RMD037, and a hole in its place. That is right for `{someObject}` among children, and wrong
   * here: an async `render()` is not a stray value in a slot, it is the component having no markup
   * at all, and dropping it would turn a crash into a component that silently renders nothing. In
   * production, where RMD060 does not run, that would be the ONLY thing that happened.
   *
   * So the promise goes through untouched and trips the diff exactly as it did before this function
   * normalized anything. RMD060 above names it first, which is the half a reader needs.
   */
  if (typeof (innerRendered as { then?: unknown })?.then === "function") {
    return [innerRendered];
  }

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

  /**
   * Normalized exactly as any other children position is, and this is the fix for a crash.
   *
   * The output used to be SCANNED rather than normalized — one pass over the top level, marking
   * `HAS_REGION` when it saw a component or a list, and stamping an ownerless `list()` descriptor.
   * That covers a render whose output is flat, which is most of them. It does not cover a NESTED
   * array, and the commonest nested array there is is `{this.props.children}`: `props.children` is
   * itself an array, so `return [<i class="chrome"/>, this.props.children]` hands this function
   * `[vnode, [vnode]]`.
   *
   * The inner array was neither flattened nor looked into, so the component inside it reached the
   * element diff unmarked and threw the internal invariant: `<Payload> reached the element diff. A
   * component is a region and is reconciled by reconcileEntries; the children array it arrived in
   * was not marked as holding one.` An app-level crash, with a message written for whoever is
   * working on the framework.
   *
   * It is the intersection of this branch's headline — a render may return an ARRAY, because a
   * component owns a range — with the commonest composition there is, passing children through. Each
   * half worked alone: `<div>{this.props.children}</div>` was fine, and so was `return [<a/>, <b/>]`.
   *
   * `normalizeChildren` is what every other children position already uses, including
   * `ChildrenRegion` for a hook's `children` prop, which is the same kind of arbitrary content. It
   * groups a nested array into a region of its own, stamps a `list()` with the same
   * `origin:position` identity the scan minted by hand, sets the marker, and keeps one entry out per
   * entry in — which is what makes `SLOT_SYM` mean "this piece of JSX". Running it over an already
   * normalized array is a no-op on every branch: an owner already stamped is kept, a vnode is
   * passed through, and `false` holes survive as themselves.
   */
  return normalizeChildren(children, component[GLOBAL_RUNTIME].id);
}
