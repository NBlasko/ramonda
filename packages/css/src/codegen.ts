import { nameFor } from "./compiler/dollar";
import { SYNTAX, type Kind, isVariable } from "./declared";

/**
 * What a project's declared variables become: a stylesheet, and a module to write them with.
 *
 * ## Two outputs from one declaration, which is the point
 *
 * `DESIGN.md` settles that the config is the SOURCE and the CSS is output — a project does not write
 * `:root` at all. That is what makes the fallback one value used twice rather than a second copy of
 * a number kept in step by hand: the same declaration becomes the rule that sets the variable and
 * the fallback every use carries.
 *
 * - **The stylesheet** sets each variable and registers it with `@property`, so a wrong value that
 *   arrives at runtime — from a server, from somebody's own CSS — is refused by the browser. Types
 *   cannot reach that, and it is free here because the kind is already written.
 * - **The module** is `$`, the object a block and ordinary TypeScript both reach a variable through.
 *
 * ## What is NOT here
 *
 * Themes. A variable may be set by a media query, an ancestor, a tenant's values from a server, or
 * code this never sees, and modelling any of that was tried and dropped — the reasons are in
 * `DESIGN.md`. The names are readable precisely so overriding is ordinary CSS.
 */

/** One variable, once its path is known. */
export interface Named {
  /** The path it was declared at, `color.primary.main`, for a message that points at the config. */
  readonly path: string;
  /** The custom property, `--color-primary-main`. */
  readonly name: `--${string}`;
  readonly kind: Kind;
  readonly value: string | number;
}

/** A group of declared variables, as the config holds them. */
export type Declarations = { readonly [name: string]: unknown };

function refuse(message: string): never {
  throw new Error(`[ramonda-css] ${message}`);
}

/**
 * Every declared variable, flattened, in the order the config declares them.
 *
 * **Declaration order rather than sorted**, because the stylesheet is something people read: a
 * palette written together stays together. Nothing depends on the order — these are distinct names
 * on one element, so no two of them can be in the cascade's way.
 */
export function namesIn(declarations: Declarations): readonly Named[] {
  const found: Named[] = [];

  const walk = (group: Declarations, trail: readonly string[]): void => {
    for (const [segment, one] of Object.entries(group)) {
      const here = [...trail, segment];

      if (isVariable(one)) {
        found.push({
          path: here.join("."),
          name: nameFor(here.join(".")),
          kind: one.kind,
          value: one.value as string | number,
        });
        continue;
      }

      if (typeof one === "object" && one !== null) {
        walk(one as Declarations, here);
      }
    }
  };

  walk(declarations, []);
  return found;
}

/**
 * Two paths spelling one custom property, which the config cannot see happening.
 *
 * `{ "a-b": { c } }` and `{ a: { "b-c" } }` both reach `--a-b-c`, because the separator between
 * levels is a character a name may also hold. Left alone the second would overwrite the first in the
 * stylesheet, and `$` would offer two paths to one variable with nothing said anywhere.
 *
 * **Separate from {@link namesIn} on purpose.** The CHECKER asks that function what a project
 * declares, once per block, and a collision is not a per-block fault — it is one fault about the
 * config, and it belongs to whoever writes the files. So the walk answers and this decides.
 */
export function verifyNames(named: readonly Named[]): void {
  const claimed = new Map<string, string>();

  for (const one of named) {
    const already = claimed.get(one.name);
    if (already !== undefined) {
      refuse(
        `two variables spell one custom property.\n\n` +
          `        \`${already}\` and \`${one.path}\` both become \`${one.name}\`.\n\n` +
          `        A level is joined to the next with a dash, and a name may hold one too, so\n` +
          `        two paths can meet. Rename either.`,
      );
    }
    claimed.set(one.name, one.path);
  }
}

/**
 * The `@property` rule for one variable, or nothing when registering would say nothing.
 *
 * **`inherits: true`, and that is not a preference.** An unregistered custom property inherits, so
 * a registration saying `false` would quietly change how every existing use behaves — a variable set
 * on `:root` would stop reaching the elements reading it. The registration exists to add a guarantee,
 * not to alter the cascade.
 *
 * **`any` is registered too, and my first reason for skipping it was wrong.** `*` accepts every token
 * sequence, so the rule refuses nothing — that much was right. But refusing is not the only thing a
 * registration does: `initial-value` is what makes the name resolve when NOTHING sets it, and
 * measured, `syntax: "*"` with an initial value does exactly that. Two different guarantees, and I
 * had collapsed them into one.
 *
 *     `*` WITH initial-value, never set      reads "anything at all"
 *     `*` without initial-value, never set   reads ""
 *
 * ## What registering changes besides refusing, measured in Chrome
 *
 * A registered variable's COMPUTED value is normalised, where an unregistered one reads back
 * verbatim:
 *
 *     registered   `--x: #10b981`   reads  "rgb(16, 185, 129)"
 *     unregistered `--x: #10b981`   reads  "#10b981"
 *     registered   `--x: 2rem`      reads  "32px"
 *
 * That is usually what a reader wants — a resolved value rather than a token — but it means `read`
 * cannot promise to hand back the literal that was written, and a length comes back absolutised
 * against the element it was read on. Worth knowing before it surprises somebody.
 *
 * And the refusal is real, including the case a type cannot express: `<integer>` given `1.5` falls
 * to its initial value, measured.
 */
function registration(one: Named): string {
  return (
    `@property ${one.name} {\n` +
    `  syntax: "${SYNTAX[one.kind]}";\n` +
    `  inherits: true;\n` +
    `  initial-value: ${one.value};\n` +
    `}`
  );
}

/** The TypeScript identifier-safe spelling of a path segment, for the emitted object. */
function key(segment: string): string {
  return JSON.stringify(segment);
}

/** The emitted module's shape, nested the way the config was written. */
function moduleTree(named: readonly Named[]): string {
  const root: Record<string, unknown> = {};

  for (const one of named) {
    const segments = one.path.split(".");
    let here = root;
    for (const segment of segments.slice(0, -1)) {
      here[segment] ??= {};
      here = here[segment] as Record<string, unknown>;
    }
    here[segments[segments.length - 1]] = one;
  }

  const write = (node: Record<string, unknown>, indent: string): string => {
    const lines = Object.entries(node).map(([segment, next]) => {
      if (next !== null && typeof next === "object" && "name" in (next as Named)) {
        const one = next as Named;
        return `${indent}  ${key(segment)}: v(${JSON.stringify(one.name)}, ${JSON.stringify(one.value)}, ${JSON.stringify(one.kind)}),`;
      }
      return `${indent}  ${key(segment)}: {\n${write(next as Record<string, unknown>, `${indent}  `)}\n${indent}  },`;
    });
    return lines.join("\n");
  };

  return `{\n${write(root, "")}\n}`;
}

/** What one run of codegen produces. Empty strings when a project declares nothing. */
export interface Generated {
  /** `:root`, and one `@property` per variable that can be registered. */
  readonly css: string;
  /** The `$` module, in TypeScript, for the project's own compiler to read. */
  readonly module: string;
}

const HEADER = "/* Generated by @ramonda/css from ramonda.css.ts. Do not edit. */";

export function generate(declarations: Declarations): Generated {
  const named = namesIn(declarations);
  verifyNames(named);

  if (named.length === 0) return { css: "", module: "" };

  const root = named.map((one) => `  ${one.name}: ${one.value};`).join("\n");
  const registrations = named
    .map(registration)
    .filter((one) => one !== "")
    .join("\n\n");

  const css = `${HEADER}\n\n:root {\n${root}\n}\n${registrations === "" ? "" : `\n${registrations}\n`}`;

  const module =
    `${HEADER}\n\n` +
    `import { v } from "@ramonda/css";\n\n` +
    `/** Every variable this project declares. Reach one by the path it was declared at. */\n` +
    `export const $ = ${moduleTree(named)} as const;\n`;

  return { css, module };
}
