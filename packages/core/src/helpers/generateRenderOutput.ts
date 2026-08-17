import type { BaseComponent, RamondaNode } from "../types/vdom";
import { GLOBAL_RUNTIME, COMPONENT_RUNTIME } from "../core/runtime";
import { resolveHostTag } from "./hostTag";
import type { HostMeta } from "../types/commonTypes";
import { createRamonda } from "../vdom/CreateRamonda";
import { isArray } from "./utils";
import { HOST_META, hostStyle, HOST_TAG, HAS_LIST } from "./constants";
import { isListNode } from "../vdom/guards";
import { renderPhase } from "../debug/renderPhase";
import { checkRenderStability, isStrictRender } from "../debug/renderStability";
import { currentOrigin } from "../core/origin";

export function generateRenderOutput(component: BaseComponent) {
  if (__DEV__) {
    // render() is the one moment no signal setter may fire. Mark who is
    // rendering so State.set can report the write (RMD001). Covers @Host's
    // props callback too, since it also runs while building the output.
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

function buildRenderOutput(component: BaseComponent) {
  // Everything render() builds is stamped with this component, so the diff can
  // tell a component's own elements from ones handed to it through a prop.
  // Saved and restored rather than cleared: @Host's props callback and a hook
  // getter both run inside here, and a list must carry its owner.
  const previousOrigin = currentOrigin.id;
  currentOrigin.id = component[GLOBAL_RUNTIME].id;

  let innerRendered: RamondaNode;
  try {
    innerRendered = (component as Required<BaseComponent>).render();
  } finally {
    currentOrigin.id = previousOrigin;
  }

  const ctor = component.constructor as { [HOST_META]?: HostMeta };
  const meta = ctor[HOST_META];

  // The default host is a transparent <ramonda-host display:contents>. @Host
  // swaps it for a real element (tag already uppercased by the decorator).
  //
  // Resolved once per instance and cached: with a tag callback this reads
  // rawProps, NOT the props proxy, on purpose. Going through the proxy would
  // subscribe the component to that prop and make the host tag look reactive —
  // and a host tag that changes under a live component is exactly what must not
  // happen. `""` caches "no @Host", so the lookup is skipped on later renders.
  const componentRuntime = component[COMPONENT_RUNTIME];
  let resolvedTag = componentRuntime.hostTag;
  if (resolvedTag === undefined) {
    resolvedTag = resolveHostTag(component.constructor, componentRuntime.rawProps) ?? "";
    componentRuntime.hostTag = resolvedTag;
  }

  let wrapperTag = HOST_TAG;
  let baseStyle = hostStyle;
  if (resolvedTag) {
    wrapperTag = resolvedTag;
    baseStyle = "";
  }

  const componentAttributes: Record<string, any> = {
    style: baseStyle,
    // Reactive host attributes from @Host's props callback. This runs on every
    // render, so it tracks component state; spread over the defaults above.
    ...(meta?.props ? meta.props(component) : undefined),
  };

  // Dev-only, namespaced debug marker (visible in the Elements panel). Not
  // present in production, and cannot collide with a user's `name` attribute.
  // Devtools reads the component reference (_componentDefinition), not this.
  if (__DEV__) {
    componentAttributes["data-ramonda"] = component.constructor.name;
  }

  const key = component.props.key;
  if (key != null) componentAttributes.key = key;

  const children = isArray(innerRendered) ? innerRendered : [innerRendered];

  // render()'s output becomes the host's children directly — it never passes
  // through flattenMixedArray, which is where the marker is normally set. Without
  // this, a list returned straight from render() would reach the diff unmarked
  // and be reconciled as if it were a single vnode. The scan is over the host's
  // direct children only, which is one item in the overwhelming majority of
  // components.
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (isListNode(child)) {
      (children as { [HAS_LIST]?: boolean })[HAS_LIST] = true;

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

  return createRamonda(wrapperTag, componentAttributes, children);
}
