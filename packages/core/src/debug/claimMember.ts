import { diagnose } from "./diagnostics";

/**
 * DEV-only: notices a decorator whose effect a member already has, and reports `RMD050`.
 *
 * ## Two faults, one code
 *
 * **The same decorator twice on one member.** `@state @state n = 1` is not a broken program — measured:
 * one render per write, the right value, one entry in `STATE_KEYS`, because the second application
 * installs the same accessor over the first. So the result is right and the belief behind it is not,
 * which is what a warning is for.
 *
 * **Two decorators that give a member the same thing.** `@state @persist n` is the case: `@state`
 * already puts a field in the hydration blob, so `@persist` beside it adds nothing. Measured — the name
 * lands in both `STATE_KEYS` and `PERSIST_KEYS` and is written to the blob twice with the same value.
 *
 * A pair that is NOT this, and must stay silent: `@created @mounted`, `@created @updated`,
 * `@mounted @destroyed`, `@onWindow @onDocument`, `@interval @timeout`, `@watchProp @updated` — every one
 * measured as doing real work twice, which is the point of putting two on one method. And the pairs that
 * make no sense at all already throw, from `assertField` / `assertMethod` / `assertMethodOrGetter`, with a
 * message naming the member: `@state @compute`, `@compute @persist`, `@state @watchProp`,
 * `@memoized @compute`. This code exists for the gap between those two sets.
 *
 * ## Why a CAPABILITY rather than a decorator name
 *
 * `@state` and `@persist` are different names for one thing here — "this field travels in the hydration
 * blob" — so claiming the decorator's name would miss the pair. Each caller claims what it GIVES the
 * member, and the two of them claim the same string.
 *
 * ## Why per instance
 *
 * Member decorators register from `addInitializer`, which runs per instance, so the record has to live
 * there too. It is a DEV-only Set on the instance: nothing allocates it in a production build, because
 * every call site is inside `if (__DEV__)`. `diagnose` dedupes by `component.member`, so a list of a
 * thousand rows reports once rather than once per row.
 */
const CLAIMS = Symbol("ramonda.dev.memberClaims");

interface Claimant {
  [CLAIMS]?: Set<string>;
  constructor?: { name?: string };
}

/**
 * Records that `decorator` gave `member` the capability `gives`, and reports if something already had.
 *
 * @param gives  what the member ends up with — `"state"` for a signal, `"serialized"` for a field in the
 *               hydration blob, `"memoized"` for a cached handler. Two decorators sharing one of these
 *               are two spellings of one effect.
 *
 * **At most one report per member.** `@state` gives a field two capabilities — a signal, and a place in
 * the hydration blob — so a doubled `@state` collides on both, and saying it twice about one line says
 * nothing extra. Capping per member rather than silencing the derived capability is what keeps the
 * `@state`/`@persist` pair caught in BOTH orders: member decorators apply bottom-up, so whichever is
 * written lower claims first, and either one may be the one that notices. Measured — silencing the
 * consequence lost the pair whenever `@persist` was the lower of the two.
 */
export function claimMember(instance: object, member: string, decorator: string, gives: string): void {
  const owner = instance as Claimant;
  let claims = owner[CLAIMS];
  if (!claims) {
    claims = new Set();
    Object.defineProperty(owner, CLAIMS, { value: claims, enumerable: false, configurable: true });
  }

  const key = `${member}:${gives}`;
  if (claims.has(key)) {
    // One word per member, whichever capability collided first.
    const said = `reported:${member}`;
    if (claims.has(said)) return;
    claims.add(said);

    const component = owner.constructor?.name ?? "a component";
    diagnose("RMD050", `${component}.${member}:${gives}`, `\`${member}\` on <${component} /> already has it.`, {
      component,
      member,
      decorator,
      gives,
    });
    return;
  }
  claims.add(key);
}
