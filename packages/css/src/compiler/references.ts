import { classNameFor } from "./names";
import { normalise } from "./normalise";
import { readBlock } from "./read";
import { findBlocks } from "./scan";

/**
 * Every named site in a file, as the binding it is assigned to and the CSS name it becomes.
 *
 * ## Why a reference is resolved at BUILD time
 *
 * `const slide = @@keyframes( … )` compiles to a string, and a block that refers to it does so
 * through a hole — `animation: {{slide}} 3s`. A hole is ordinarily a custom property set on an
 * element, which is exactly right for a value the runtime computes and wrong for this one in two
 * ways, one merely wasteful and one fatal:
 *
 * - the name was decided by this compiler three lines up, so an element carrying it as a variable is
 *   work done at run time for a constant;
 * - **`var()` takes a literal name.** `var({{angle}})` would become `var(var(--r-…-0))`, and
 *   measured in Chromium nothing resolves — the declaration is dropped and the style is silently
 *   absent. A registered property could be READ by nothing.
 *
 * So a hole whose expression is exactly one of these bindings is not a hole. It is that name, and
 * the read writes it straight into the text — which is also what lets one stand in a property NAME,
 * the position a hole may never occupy, and the only way a registered property can be SET.
 *
 * ## Why the name of a `@property` is different
 *
 * `@keyframes r-… { … }` is a valid rule and `@property r-… { … }` is not: what `@property`
 * registers is a CUSTOM PROPERTY, and a custom property is spelled `--` and then a name. So the two
 * dashes are part of what it is called, in the stylesheet and in the string the site compiles to,
 * and `var({{angle}})` is `var(--r-…)` because that is the only thing it could be.
 *
 * ## Order
 *
 * Built in source order, so a named site sees only the ones above it — which is what a `const` does
 * anyway, and what keeps a site that refers to another from being a question about itself.
 */
export function namedSites(source: string): Map<string, string> {
  const found = new Map<string, string>();

  for (const site of findBlocks(source)) {
    if (site.at === undefined || site.name === "") continue;

    // Tolerant: this runs in an editor as well as in a build, and a name is still a name while the
    // block under it is half-typed. What is wrong with the block is reported by whoever reads it
    // properly — saying it twice, from here, would say it about the wrong thing.
    const read = readBlock(source, site.open, "", { tolerant: true, resolve: (name) => found.get(name) });
    const className = classNameFor(normalise(read.block));
    found.set(site.name, site.at === "property" ? `--${className}` : className);
  }

  return found;
}
