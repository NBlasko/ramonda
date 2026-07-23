import { HOST_META } from "./constants";
import type { HostMeta } from "../types/commonTypes";

import { assertResolvedHostTag } from "../debug/validateDecorator";

type HostCarrier = { [HOST_META]?: HostMeta };

/**
 * The host tag a component will carry, or undefined when it uses the default
 * `<ramonda-host>`.
 *
 * Two callers with different needs share this on purpose: the render path, which
 * builds the element, and the diff, which decides whether an existing element
 * can be reused. If those two ever computed the tag differently, a node would be
 * kept whose tag no longer matched what the component declares.
 */
export function resolveHostTag(
  componentClass: unknown,
  props: Record<string, unknown> | undefined,
): string | undefined {
  const meta = (componentClass as HostCarrier | undefined)?.[HOST_META];
  if (!meta) return undefined;
  if (meta.tag !== undefined) return meta.tag;
  if (meta.tagFromProps === undefined) return undefined;

  const resolved = meta.tagFromProps(props ?? {});
  if (__DEV__) {
    assertResolvedHostTag(resolved, (componentClass as { name?: string })?.name ?? "a component");
  }
  // Not guarded in production: an invalid name reaches document.createElement,
  // which rejects it. Both builds fail on the same input — DEV just says why.
  return String(resolved).toUpperCase();
}

/**
 * Whether an existing DOM node's tag still matches what this vnode's component
 * would build. Called from the diff's matching step, BEFORE the component is
 * constructed, which is why it reads the vnode's props rather than an instance.
 *
 * The diff matches a component by its class, and two `<Card as="section" />` /
 * `<Card as="article" />` are the same class — so without this the reconciler
 * would hand one's `<section>` to the other and the tag would silently be wrong.
 * Deciding it here, in the framework, is what keeps `key` out of it: a key the
 * developer has to remember is a key they will forget, and the failure is quiet.
 *
 * Static tags return early. A component whose tag is fixed cannot disagree with
 * another vnode of the same class, so the common case costs one property read
 * and no call.
 */
export function hostTagMatches(
  // Structural on purpose: the two call sites hold differently-narrowed vnode
  // types, and this reads only these two fields.
  vnode: { name: unknown; attributes?: Record<string, unknown> },
  node: { nodeName: string },
): boolean {
  const meta = (vnode.name as HostCarrier | undefined)?.[HOST_META];
  if (meta?.tagFromProps === undefined) return true;

  return node.nodeName === resolveHostTag(vnode.name, vnode.attributes);
}
