/**
 * The fake framework, plus `Head` — for the one fixture whose rule is about it.
 *
 * A separate module rather than another declaration in `framework.ts`, and the reason is
 * measurable: `Head` is a hook class, so declaring it in the shared file put an extra hook into
 * EVERY fixture's program and moved three fixtures' component counts by one. A fixture file is
 * part of the thing under test, and adding to the shared one changes every test that counts.
 */
export * from "./framework";
import { Hook } from "./framework";

/**
 * Deliberately LOOSER than the published `MetaTag`, which is a union requiring `name`, `property`
 * or `httpEquiv`. Typing it exactly here would make the compiler refuse fixture lines this rule
 * has to be shown reading — and the rule never asks for a type in any case.
 */
export interface MetaTag {
  name?: string;
  property?: string;
  httpEquiv?: string;
  content?: string;
}
export interface LinkTag {
  rel: string;
  href: string;
  type?: string;
  sizes?: string;
}
export interface HeadOptions {
  title?: string;
  description?: string;
  meta?: readonly MetaTag[];
  link?: readonly LinkTag[];
}
export declare class Head extends Hook {}
