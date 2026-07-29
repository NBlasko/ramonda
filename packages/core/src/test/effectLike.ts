import { createSubscriptionDecorator } from "../base/decorators";
import type { Disconnect, SubscriptionOwner } from "../base/decorators";

/**
 * `@effect`'s exact old contract, reached through the door that replaced it.
 *
 * ## Why this exists
 *
 * The public `@effect` decorator is gone, but the machinery under it is not: `attachEffect`
 * still runs the effect queue, and `createSubscriptionDecorator` — plus `@onElement`,
 * `@onWindow`, `@interval`, `@timeout` — is built on it. Deleting the tests that exercised
 * that machinery would have thrown away coverage of code that still ships.
 *
 * So the tests keep exercising it, through the only public door there is. `connect` calls
 * the decorated method and hands back whatever it returned, which is precisely what
 * `@effect` did: run after the commit, re-run when a signal the body READ changes, and treat
 * a returned function as the cleanup.
 *
 * ## Why it lives in `test/` rather than in the framework
 *
 * Because it is a way of saying "an effect, unnamed" — which is the thing that was removed
 * on purpose. An app should reach for the decorator that says what it is doing:
 * `createSubscriptionDecorator` for a subscription, `@updated` for after the render,
 * `@watchProp` for a prop change, `@onWindow` for an event. This is a harness, and it is
 * here so that the tests of the shared machinery do not have to pretend to be one of those.
 */
export const effectLike = createSubscriptionDecorator(
  "effectLike",
  (_owner: SubscriptionOwner, handler: () => void) =>
    // The handler's declared return type is `void` — `createSubscriptionDecorator` bounds
    // handlers with `never[]` parameters, which is what lets a real one carry typed
    // arguments. At runtime the value is whatever the method returned, and a function among
    // those is a cleanup, so the cast says what is actually happening.
    handler() as unknown as Disconnect,
);
