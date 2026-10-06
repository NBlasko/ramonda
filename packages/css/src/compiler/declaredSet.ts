import { type Named, namesIn } from "../codegen";
import type { Config } from "../config";

/**
 * Whether a declared variable may be SET to a value — the one answer three places ask.
 *
 * A bare declaration means the variable never changes: its type is `Fixed<…>` and `toStyle` refuses
 * to set it. A `range` lists what it may become. `@property` cannot forbid anything, because CSS
 * lets any rule set a custom property — so the promise is kept here, and asked of every place a
 * project can set one by name: a block, a stylesheet, and a `style` attribute.
 *
 * One function rather than three copies, because three readers of one rule is how this repository's
 * rules have drifted before: each was right alone, and they disagreed with each other.
 */

/** Every declared variable by its custom property — `--color-surface-sunken`. */
const byConfig = new WeakMap<Config, ReadonlyMap<string, Named>>();

export function declaredByName(config: Config): ReadonlyMap<string, Named> {
  const already = byConfig.get(config);
  if (already !== undefined) return already;
  const found = new Map(config.tokens === undefined ? [] : namesIn(config.tokens).map((one) => [one.name, one]));
  byConfig.set(config, found);
  return found;
}

/**
 * What is wrong with setting `one` to these values, or `undefined` when nothing is.
 *
 * `outcomes` is every value the setting may put there — one, or one per branch of a choice or a
 * match. An `undefined` among them is a value this cannot read (`var()`, code) and is left alone,
 * as a range of `"any"` is.
 */
export function againstDeclaration(one: Named, outcomes: readonly (string | undefined)[]): string | undefined {
  const variable = `\`$${one.path}\``;
  if (one.range === undefined) {
    return (
      `${variable} is declared without a \`range\`, so it never changes and nothing may set it. ` +
      `To let it change, give it one in ramonda.css.ts: \`{ value: ${JSON.stringify(one.value)}, range: [ … ] }\`.`
    );
  }
  if (one.range === "any") return undefined;

  const allowed = one.range.map((each) => String(each).toLowerCase());
  const outside = outcomes.find((text) => text !== undefined && !allowed.includes(text.toLowerCase()));
  if (outside === undefined) return undefined;
  return (
    `\`${outside}\` is not in the \`range\` of ${variable}, which may be ${one.range.join(", ")}. ` +
    "Set one of those, or add it to the range in ramonda.css.ts."
  );
}

/**
 * Whether a project that limits made-up custom properties refuses this name.
 *
 * `unknownCustomProperties: false` refuses every name that is neither a token nor one an outside
 * stylesheet sets. `"same-block"` allows one more: a LOCAL, which one block both sets and reads —
 * `local` is that set, worked out by the caller for the block (or `style` attribute) it is reading.
 * A `@@property` never reaches here by name; it is read through its binding, `var($(name))`.
 */
export function refusedAsUnknown(config: Config | undefined, name: string, local?: ReadonlySet<string>): boolean {
  const mode = config?.unknownCustomProperties;
  if (config === undefined || (mode !== false && mode !== "same-block")) return false;
  if (declaredByName(config).has(name)) return false;
  if ((config.externalCustomProperties ?? []).includes(name)) return false;
  return !(mode === "same-block" && local?.has(name) === true);
}

/** The names one block both sets and reads — what `"same-block"` allows. */
export function localNames(sets: Iterable<string>, reads: Iterable<string>): ReadonlySet<string> {
  const read = new Set(reads);
  return new Set([...sets].filter((name) => read.has(name)));
}

/** What `unknown-custom-property` says, the same in a block and in a `style` attribute. */
export function unknownMessage(name: string, config?: Config, how: "set" | "read" = "read"): string {
  const elsewhere =
    "Put a design value in `tokens`, a value from code in `@@property( … )`, or a name an outside " +
    "stylesheet sets in `externalCustomProperties`.";
  if (config?.unknownCustomProperties === "same-block") {
    return how === "read"
      ? `\`${name}\` is read here and not set in this block, and \`unknownCustomProperties: "same-block"\` keeps a ` +
          `made-up name to the block that sets it. ${elsewhere}`
      : `\`${name}\` is set here and read nowhere in this block, so it could only be for another element — ` +
          `and \`unknownCustomProperties: "same-block"\` keeps a made-up name to one block. ${elsewhere}`;
  }
  return (
    `\`${name}\` is a custom property this project does not declare, and \`unknownCustomProperties: false\` ` +
    `refuses one made up here. ${elsewhere}`
  );
}

/** Every `var(--name` a piece of text reads, with where the `var(` is. */
export function readsIn(text: string): { readonly name: string; readonly at: number; readonly length: number }[] {
  return [...text.matchAll(/var\(\s*(--[\w-]+)/gi)].map((found) => ({
    name: found[1],
    at: found.index ?? 0,
    length: found[0].length,
  }));
}

/** A value's text without a trailing `!important` and its spaces, or `undefined` for one not readable. */
export function plainValue(text: string): string | undefined {
  let value = text.trim();
  const lower = value.toLowerCase();
  if (lower.endsWith("important")) {
    const before = value.slice(0, -"important".length).trimEnd();
    if (before.endsWith("!")) value = before.slice(0, -1).trimEnd();
  }
  if (value === "" || /\bvar\s*\(/i.test(value) || value.includes("$(")) return undefined;
  return value;
}

/** One `--name: value` a stylesheet or a `style` string sets, with where its name is. */
export interface Setting {
  readonly name: string;
  readonly value: string;
  /** The offset of the name in the text read. */
  readonly at: number;
}

/**
 * Every custom property a piece of CSS SETS — a stylesheet, or the inside of a `style` string.
 *
 * Only what can stand where a declaration starts: after `{`, `;` or the beginning. Comments and
 * strings are passed over, so a `--x: y` inside either is not one. The value runs to the `;` or `}`
 * that ends it outside any parens. Nothing else about the CSS is read; this does not have to be a
 * parser, only to find these.
 */
export function settingsIn(css: string): Setting[] {
  const found: Setting[] = [];
  let at = 0;
  /** Whether the next thing read starts a declaration. */
  let start = true;

  const pastComment = (): boolean => {
    if (!css.startsWith("/*", at)) return false;
    const end = css.indexOf("*/", at + 2);
    at = end === -1 ? css.length : end + 2;
    return true;
  };
  const pastString = (): boolean => {
    const quote = css[at];
    if (quote !== '"' && quote !== "'") return false;
    at++;
    while (at < css.length && css[at] !== quote) at += css[at] === "\\" ? 2 : 1;
    at++;
    return true;
  };

  while (at < css.length) {
    if (pastComment() || pastString()) continue;
    const char = css[at];
    if (char === "{" || char === ";" || char === "}") {
      start = true;
      at++;
      continue;
    }
    if (/\s/.test(char)) {
      at++;
      continue;
    }
    if (start && css.startsWith("--", at)) {
      const name = /^--[\w-]+/.exec(css.slice(at))?.[0];
      let after = at + (name?.length ?? 2);
      while (after < css.length && /\s/.test(css[after])) after++;
      if (name !== undefined && css[after] === ":") {
        const nameAt = at;
        at = after + 1;
        const from = at;
        let depth = 0;
        let value = "";
        while (at < css.length) {
          if (css.startsWith("/*", at)) {
            pastComment();
            continue;
          }
          const here = at;
          if (pastString()) {
            value += css.slice(here, at);
            continue;
          }
          const one = css[at];
          if (one === "(") depth++;
          else if (one === ")") depth--;
          else if (depth <= 0 && (one === ";" || one === "}")) break;
          value += one;
          at++;
        }
        if (at > from || value !== "") found.push({ name, value: value.trim(), at: nameAt });
        start = false;
        continue;
      }
    }
    start = false;
    at++;
  }
  return found;
}

/** What a piece of CSS sets against the project's declarations, as `{ at, length, message }`. */
export function settingsAgainst(
  css: string,
  config: Config,
): { readonly at: number; readonly length: number; readonly message: string }[] {
  const declared = declaredByName(config);
  if (declared.size === 0) return [];
  return settingsIn(css).flatMap((setting) => {
    const one = declared.get(setting.name);
    if (one === undefined) return [];
    const message = againstDeclaration(one, [plainValue(setting.value)]);
    return message === undefined ? [] : [{ at: setting.at, length: setting.name.length, message }];
  });
}
