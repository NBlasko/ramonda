/**
 * A portal as the portals inside its block see it: whether it is off the page, and the register of
 * portals that close and open with it. `Portal` is the one implementation; it is named here, by what
 * a block needs, so the region does not reach for the hook.
 */
export interface EnclosingBlock {
  readonly away: boolean;
  join(inner: NestedBlock): void;
  part(inner: NestedBlock): void;
}

/** A portal inside another's block: told when the outer one closes, and when it opens again. */
export interface NestedBlock {
  suspend(): void;
  resume(): void;
}

/**
 * The block whose children are being reconciled right now, for the components built in it — see
 * `ComponentRuntime.block`. Set by `atTopLevel` with the rest of the list context, so every entry that
 * starts a level of its own resets it. A component built later, by a re-render inside the block,
 * takes it from its parent instead.
 */
export const enclosingBlock: { current: EnclosingBlock | undefined } = { current: undefined };
