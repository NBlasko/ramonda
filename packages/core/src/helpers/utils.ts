export const isArray = Array.isArray;

/**
 * What to call a component or a hook instance in a diagnostic.
 *
 * `constructor?.name` was written out verbatim — the optional chain and the
 * `?? "Unknown"` included — in `hydration/serialize.ts`, `hydration/restore.ts`,
 * `hydration/lint.ts` and `helpers/watchProps.ts`: four byte-identical copies of one
 * expression, plus three more spellings in `base/decorators.ts`. That is not a
 * TypeScript problem; `unknown` only made it look like one.
 *
 * `base/Context.ts` keeps its own — `holderName` — and should: its messages branch on not
 * knowing the name and drop the subject, so "Unknown" would change what they print. It answers
 * `""` for both absences it has to serve, an unnamed class and a production build with no
 * `holder` at all.
 *
 * **Both absences answer the same word here, and that is the correction.** A
 * `Object.create(null)` instance has no `constructor`; a class expression assigned to nothing has
 * one whose `name` is the empty string. This was `?? "Unknown"`, which catches the first and not
 * the second — so `""` reached every caller that writes `<${name} />` and the message read
 * `< />`. Measured on `RMD060`, the one in this family a nameless class can actually reach:
 *
 *     [RMD060] render() is async
 *     < />'s `render()` is async — it returns a promise, not markup.
 *
 * A reader sees a subject that looks like a syntax error rather than a name. Nothing wants `""`:
 * every caller either interpolates it or puts it in a dedup key, and an empty key groups two
 * different nameless components together.
 *
 * **Why half the family cannot be reached the same way, which is worth knowing before probing it:**
 * a class expression with a DECORATED member is named by the transpiler. esbuild lowers the class
 * into a temporary to apply the decorator, and the temporary's name — `_b` — becomes the class's.
 * So `RMD059`, `RMD038` and `RMD047`, which all need a member decorator to fire at all, never see
 * an empty name. Only the decorator-free paths do.
 *
 * ## Where the same `??` was corrected, and which of them a test holds
 *
 * The two absences take one word at some sites and two at others, and reading them as one is what
 * went wrong in BOTH directions. `debug/renderPhase.ts`, `debug/hydrationMismatch.ts`,
 * `debug/jsxRules.ts` and `debug/lintChildren.ts` each distinguish "no component at all" — `outside
 * a render`, `root`, `A render`, `the root` — from a component, and `??` handed the nameless one the
 * word for NO component: the report then says the markup belongs to nobody, about a component that
 * is right there, and every nameless component shares that group's dedup key.
 *
 * Pinned by a test, each proven by putting the `??` back and watching the suite fail: this helper,
 * `RMD060`'s subject, those four sites, `debug/inspector.ts`'s two panel labels,
 * `vdom/CreateRamonda.ts`'s tag, `core/DiffAndMerge.ts`'s list label, and `hydration/serialize.ts`
 * (whose fallback word was ungrammatical in the case `??` DID catch — `holds a object`).
 *
 * Changed for uniformity and NOT pinned, each saying so where it stands: `debug/claimMember.ts`
 * (needs a member decorator, so the class is named), `core/DiffAndMerge.ts`'s element-diff throw
 * (reaching it is a framework bug) and `debug/renderStability.ts`'s path label (a shape I could not
 * construct — the test written for it passed with the operator changed back, so it was deleted
 * rather than kept).
 */
/**
 * What to call a CLASS in a diagnostic — the other half of the same fault.
 *
 * `displayName` above takes an INSTANCE and reads its constructor. Several messages hold the class
 * itself instead: the hook handed to `use()`, the component on a vnode, the constructor a class
 * decorator was applied to. A class expression assigned to nothing has a `name` of `""` there too,
 * so `<${hook.name} /> was given a plain object` printed `<>`.
 *
 * `scripts/check-nameless-class.mjs` does NOT catch this half, and cannot cheaply: `${x.name}` is
 * indistinguishable from an ordinary data read — `${issue.name}`, `${graph.package.name}` — so a
 * gate over it would need an allowlist longer than the rule. What keeps it from coming back is that
 * all seven sites now read the same, so a reader copying a neighbour copies this.
 */
export function className(cls: unknown): string {
  // `unknown` and a cast, the same shape `displayName` takes below and for the same reason: a
  // generic class parameter is constrained by its CONSTRUCT signature, which does not structurally
  // include `name`, so a narrower type is rejected at every real call site.
  return (cls as { name?: string } | null | undefined)?.name || "Unknown";
}

export function displayName(value: unknown): string {
  return (value as { constructor?: { name?: string } } | null | undefined)?.constructor?.name || "Unknown";
}
