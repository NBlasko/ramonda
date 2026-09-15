import { defineConfig, kind } from "@ramonda/css/config";

/**
 * The playground's own `ramonda.css.ts` — here to be CHANGED.
 *
 * Every constraint below is live: edit this file, and the types, the editor's suggestions and
 * `pnpm --filter @ramonda/playground-core check-types` all move with it. `WALKTHROUGH.md` beside
 * this file is a list of edits to make and what each one should do, so a claim can be checked rather
 * than believed.
 *
 * The rules are deliberately mild, because this is also a real app that has to keep building. The
 * walkthrough's stricter suggestions are the ones worth trying and then undoing.
 */
export default defineConfig({
  /**
   * The variables this project declares — a name, a kind and a fallback each.
   *
   * Codegen writes `ramonda.css.generated.css`, which sets them, and
   * `ramonda.css.generated.ts`, which is where `$` comes from. Neither is committed: they are
   * written on every build and on `ramonda-css codegen`.
   */
  variables: {
    color: kind("color", {
      accent: { main: "#10b981", quiet: "#00b37e" },
      surface: { base: "#ffffff", sunken: "#f3f4f6" },
      text: { primary: "#111827", muted: "#6b7280" },
    }),
    space: kind("length", {
      gutter: { tight: "8px", normal: "16px", wide: "24px" },
    }),
    size: kind("length", {
      radius: { small: "4px", pill: "999px" },
    }),
    motion: kind("time", {
      quick: "120ms",
      calm: "400ms",
    }),
  },

  /**
   * The units this project uses, **by family** — a family not named here is not constrained.
   *
   * This is the project-wide sweep, read by the checker, and it reaches values no type describes:
   * `transition`, `rotate`, `grid-template-columns`. Its namesake inside `properties` is a different
   * thing — per property, and it reaches the types.
   *
   * Note `%` is its own family. That is the point of the shape: saying lengths are `px` and `rem`
   * must not make `width: 50%` a fault.
   */
  // units: { length: ["px", "rem"], percentage: ["%"] },

  /**
   * What this project permits per property.
   *
   * `z-index` is the one real constraint here, and it is the shape most projects want first: a
   * layering scale rather than whatever number somebody reached for. The rest of the walkthrough's
   * suggestions are commented out, because switching shorthands off would stop this app compiling —
   * which is the point of trying it, in a branch you throw away.
   */
  properties: {
    "z-index": { values: [0, 1, 10, 100, 1000] },

    // Try these one at a time. Each is explained in WALKTHROUGH.md.
    //
    // "*": { shorthand: false },          // `padding` stops existing; write `padding-left`
    // "*": { arity: 1 },                  // one value per property — and `margin: 0 auto` goes
    // "*": { units: ["px", "rem", "%"] }, // `em`, `vh` and the other 45 are refused
    // "letter-spacing": { units: ["em"] },
  },
});
