/** Rules about tokens and custom properties: unknown, set against their declaration, read by hand, made up. */

import { type Config } from "../../config/config";
import { namesIn } from "../../config/codegen";
import { type ValuePart, textOnly, textPartsOf } from "../ast";
import {
  againstDeclaration,
  declaredByName,
  localNames,
  plainValue,
  readsIn,
  refusedAsUnknown,
  unknownMessage,
} from "../declaredSet";
import { nameFor } from "../dollar";
import { nearest } from "../nearest";
import { type Block, declarationsIn } from "./shared";
import { type Finding } from "./index";

/**
 * The paths a config declares, worked out once per config rather than once per block.
 *
 * A `WeakMap` because a config object outlives no more than the run that made it, and a bundler
 * holds one per package for the length of a watch.
 */
const declaredPaths = new WeakMap<Config, ReadonlySet<string>>();

function pathsDeclaredBy(config: Config): ReadonlySet<string> {
  const already = declaredPaths.get(config);
  if (already !== undefined) return already;

  const paths = new Set(config.tokens === undefined ? [] : namesIn(config.tokens).map((one) => one.path));
  declaredPaths.set(config, paths);
  return paths;
}

/**
 * A custom property made up in a block, in a project that switched that off — the block's half of
 * `unknown-custom-property`; the `style` attribute's is in `typed/styleAttribute.ts`. Set or read: `--brand: red`
 * and `var(--brand)`, at any depth, in a choice's branches and a match's arms too.
 */
export function unknownCustomProperty(
  block: Block,
  config: Config,
  references: ReadonlyMap<string, string> | undefined,
  findings: Finding[],
): void {
  /**
   * A `@@property`'s generated name is DECLARED — written through its binding, `$(angle): 45deg` —
   * so it is no made-up name. Refusing it would break a correct build, in a block and in a
   * `@@keyframes` frame alike.
   */
  const registered = new Set([...(references?.values() ?? [])].filter((name) => name.startsWith("--")));
  const declarations = declarationsIn(block);

  // What this block sets and reads, at any depth — the locals `"same-block"` allows.
  const sets = declarations.map((item) => item.property.trim()).filter((name) => name.startsWith("--"));
  const reads = declarations.flatMap((item) =>
    textPartsOf(item.value).flatMap((part) => readsIn(part.text).map((one) => one.name)),
  );
  const local = localNames(sets, reads);

  for (const item of declarations) {
    const property = item.property.trim();
    if (
      property.startsWith("--") &&
      item.at !== undefined &&
      !registered.has(property) &&
      refusedAsUnknown(config, property, local)
    ) {
      findings.push({
        rule: "unknown-custom-property",
        at: item.at,
        length: property.length,
        message: unknownMessage(property, config, "set"),
      });
    }
    for (const part of textPartsOf(item.value)) {
      if (part.at === undefined) continue;
      for (const read of readsIn(part.text)) {
        if (registered.has(read.name) || !refusedAsUnknown(config, read.name, local)) continue;
        findings.push({
          rule: "unknown-custom-property",
          at: part.at + read.at,
          length: read.length,
          message: unknownMessage(read.name, config, "read"),
        });
      }
    }
  }
}

/**
 * A declared variable SET in a block, against what its declaration allows — the block's half of
 * `declaredSet.ts`, which holds the judgement a stylesheet and a `style` attribute share.
 *
 * It covers every place a block can set one: a fixed variable (`--color-surface-sunken: red`) at
 * the top, in `&:hover`, in a `when` and in a match arm, and a ranged one outside its range. A
 * choice or a match is judged branch by branch.
 */
export function setAgainstItsDeclaration(block: Block, config: Config, findings: Finding[]): void {
  const named = declaredByName(config);
  if (named.size === 0) return;

  const textOf = (value: readonly ValuePart[]): string | undefined => {
    const written = textOnly(value);
    return written === undefined ? undefined : plainValue(written);
  };
  /** Every value the declaration may put there — one, or one per branch or arm. */
  const outcomes = (value: readonly ValuePart[]): (string | undefined)[] => {
    const [only] = value;
    if (value.length === 1 && only.kind === "choice") {
      return [...only.branches.map((branch) => textOf(branch.value)), textOf(only.otherwise)];
    }
    if (value.length === 1 && only.kind === "match") return only.arms.map((arm) => textOf(arm.value));
    return [textOf(value)];
  };

  for (const item of declarationsIn(block)) {
    const one = named.get(item.property.trim());
    if (one === undefined || item.at === undefined) continue;
    const message = againstDeclaration(one, outcomes(item.value));
    if (message === undefined) continue;
    findings.push({
      rule: "token-set-against-its-declaration",
      at: item.at,
      length: item.property.trim().length,
      message,
    });
  }
}

/**
 * `$a.b.c` naming a variable this project never declared.
 *
 * **This is the only thing standing between a typo and a `var()` into nothing.** The compiler emits
 * `var(--a-b-c)` from the path alone and reads no config to do it — deliberately, so that the CLI,
 * the bundler and the editor cannot disagree about what a `$` compiles to. The cost of that choice
 * is that a misspelled path compiles perfectly well, into a name nothing sets. Measured, that is
 * not a missing value but a wrong one: `height: var(--never-set)` laid an element out at 0px, with
 * nothing reported anywhere.
 *
 * The types say the same thing in an editor, through the generated `$`. This says it in CI, in a
 * hook, and to a reviewer — none of which run TypeScript over the block.
 *
 * ## A group is reported too
 *
 * `$color.primary` names three variables and no value. Left alone it would compile to
 * `var(--color-primary)`, which nothing sets, so it is the same fault with a better message
 * available: the path exists, it is just not a leaf.
 *
 * ## Declaring nothing is reported
 *
 * A config that permits everything when it was never written means people can do as they like
 * without ever learning the config exists. A config OBJECT that declares no variables is therefore
 * told so. No config object at all is different and stays silent — nobody asked.
 */
/**
 * `var(--color-accent)` written by hand for a variable the project declares.
 *
 * It renders the same as `$color.accent`, and it is the one spelling of a declared variable nothing
 * checks: rename the variable in `ramonda.css.ts` and this goes on reading the old name, which
 * nothing sets — measured for `unknown-token`, an unset `var()` lays the element out as if the
 * property were never written. A `var()` with a fallback is left alone, because `$` cannot say one.
 */
export function variableByHand(block: Block, config: Config, findings: Finding[]): void {
  const byName = new Map([...pathsDeclaredBy(config)].map((path) => [nameFor(path) as string, path]));
  if (byName.size === 0) return;

  for (const item of declarationsIn(block)) {
    for (const part of item.value) {
      if (part.kind !== "text" || part.at === undefined) continue;
      for (const found of part.text.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
        const path = byName.get(found[1]);
        if (path === undefined) continue;
        findings.push({
          rule: "token-by-hand",
          at: part.at + (found.index ?? 0),
          length: found[0].length,
          message:
            `\`${found[0]}\` reads a token this project declares, and nothing checks it written this way. ` +
            `Write \`$${path}\`, which follows the config.`,
        });
      }
    }
  }
}

export function unknownVariable(block: Block, config: Config, findings: Finding[]): void {
  const declared = pathsDeclaredBy(config);

  const groups = new Set<string>();
  for (const path of declared) {
    const segments = path.split(".");
    for (let count = 1; count < segments.length; count++) groups.add(segments.slice(0, count).join("."));
  }

  const among = [...declared];
  const tops = new Set([...declared].map((path) => path.split(".")[0]));

  for (const item of declarationsIn(block)) {
    for (const part of item.value) {
      if (part.kind !== "variable" || part.at === undefined) continue;
      if (declared.has(part.path)) continue;

      const written = `$${part.path}`;
      const meant = nearest(part.path, among);

      const message =
        part.path === ""
          ? "a `$` on its own names nothing — write `$group.name` for a token, or `$( … )` for code."
          : declared.size === 0
            ? `\`${written}\` names a token, and this project declares no tokens.\n\n` +
              `        Declare them in \`ramonda.css.ts\`, with a kind and a fallback each:\n` +
              `        tokens: { $color: kind("color", { primary: { main: "#3b82f6" } }) }`
            : groups.has(part.path)
              ? `\`${written}\` names a group of tokens rather than one of them. Write a token.`
              : !groups.has(part.path.split(".")[0])
                ? /**
                   * A GROUP the project does not have: `$` and a name is only ever a theme
                   * variable, so `$props.tone` is most likely a reach for a value from code.
                   */
                  `\`${written}\` names no group of tokens this project has — its groups are ` +
                  `${[...tops].map((one) => `\`$${one}\``).join(", ")}.` +
                  (meant === undefined ? "" : ` Did you mean \`$${meant}\`?`) +
                  " A value from code is written `$( … )`."
                : `\`${written}\` is not a token this project declares.` +
                  (meant === undefined ? "" : ` Did you mean \`$${meant}\`?`);

      findings.push({ rule: "unknown-token", at: part.at, length: part.length ?? written.length, message });
    }
  }
}

/**
 * A variable set by one name and read by another, when the author meant one.
 *
 * A named `@@property` block is a TypeScript binding, and `var($(accent))` resolves at build time
 * to the name that block generated. Setting it with the same binding works end to end — `$(accent):
 * blue` writes `--r-…: blue` and the `var()` reads it back.
 *
 * **Writing the literal name instead is two variables.** Measured:
 *
 * ```
 * --accent: blue;               ->  .r-… { --accent: blue }       ONE variable
 * background: var($(accent));  ->  reads --r-k8u6ISIlk           ANOTHER
 * ```
 *
 * The author believes they set what they read; the `var()` falls back to the `@property`
 * `initial-value` and the declaration they wrote does nothing for it.
 *
 * **It matches by NAME and nothing else**, which is what keeps it precise: `--accent` set while the
 * binding `accent` is read. A literal nobody has a binding for is ordinary CSS and is left alone;
 * so is a block that reads the literal it set.
 */
export function setByAnotherName(block: Block, references: ReadonlyMap<string, string>, findings: Finding[]): void {
  // What a resolved reference looks like once it is text: the generated name, by binding.
  const generated = new Map([...references].map(([binding, name]) => [name, binding]));
  const read = new Set<string>();
  const set: { name: string; at: number }[] = [];

  for (const item of declarationsIn(block)) {
    if (item.property.startsWith("--") && item.at !== undefined) {
      set.push({ name: item.property, at: item.at });
    }
    for (const part of item.value) {
      if (part.kind !== "text") continue;
      const binding = generated.get(part.text);
      if (binding !== undefined) read.add(binding);
    }
  }

  for (const one of set) {
    const binding = one.name.slice(2);
    if (!read.has(binding)) continue;

    findings.push({
      rule: "custom-property-set-by-another-name",
      at: one.at,
      length: one.name.length,
      message:
        `\`${one.name}\` is set here, and \`${binding}\` is read as a binding below — those are two ` +
        `different custom properties, so this declaration does nothing for it. Write ` +
        `\`$(${binding}): …\` to set the one you read.`,
    });
  }
}

/** `var(` and nothing but whitespace since — the position where a NAME belongs. */
const OPENS_A_VAR = /var\(\s*$/i;

/**
 * A hole standing where `var()` takes a name.
 *
 * **Measured in Chromium 151, and it is silent:**
 *
 * ```
 * .a { --name: --accent; --accent: #10b981; background: var(var(--name)); border: 4px solid red }
 *       background -> rgba(0, 0, 0, 0)      the declaration is gone
 *       border     -> 4px rgb(255, 0, 0)    and the one beside it survives
 * ```
 *
 * `var()` resolves a literal name, not a value that happens to spell one — so a hole there compiles
 * to `var(var(--r-…-0))` and the declaration does nothing. ONE declaration, not the rule, which is
 * what makes it hard to see.
 *
 * It is the shape a reference that did NOT resolve produces: `background: var($(accent))` with an
 * `accent` nothing could resolve stays a hole. A reference that resolves never reaches here: it is
 * written into the text before any rule runs, so there is no hole to find. That is what the
 * named-site design is for, and it is asserted.
 *
 * The FALLBACK is a different position and is left alone — `var(--x, $(colour))` is a value where a
 * value belongs, and `var(--unset, var(--hole))` was measured resolving correctly. Only the first
 * argument is a name.
 */
export function holeAsAVariableName(block: Block, findings: Finding[]): void {
  for (const item of declarationsIn(block)) {
    for (const [position, part] of item.value.entries()) {
      if (part.kind !== "hole" || position === 0) continue;
      const before = item.value[position - 1];
      if (before.kind !== "text" || !OPENS_A_VAR.test(before.text)) continue;

      findings.push({
        rule: "hole-as-a-custom-property-name",
        at: part.at ?? item.valueAt ?? item.at ?? 0,
        length: part.length ?? 2,
        /**
         * What is left when this fires is a reference that did not resolve, and the reasons are
         * specific: a bare package specifier, which `namedSites` refuses because resolving one
         * needs a bundler's resolver; a file that is not there; or a name the module does not
         * export. Naming the CATEGORY instead would send an author to rewrite architecture that
         * works.
         */
        message:
          "`var()` takes a literal name, and a hole is a value — this compiles to " +
          "`var(var(--\u2026))`, which resolves to nothing and drops the declaration in silence. " +
          "A `@@property( \u2026 )` is a name it can read, in this file or imported from a " +
          "relative module — so this one did not resolve: check the path, the export, and that " +
          "the specifier begins with `.`, since a package name needs a bundler's resolver.",
      });
    }
  }
}
