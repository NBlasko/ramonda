import ts from "typescript";
import { isThisUse, positionOf } from "../syntax";
import { importedFromCore } from "./core-import";
import type { Rule } from "./rule";

/**
 * Two entries in one `Head` that are the same tag, so only the second is written.
 *
 * `Head` matches the tags it has already written so that an update REPLACES them rather than
 * appending — that is what stops a page from collecting a second copy on every navigation. A
 * `<meta>` is matched by `name`, `property` or `http-equiv`; a `<link>` by `rel` and `href`. Both
 * are collected into a map keyed by that identity, so two entries with one identity are one tag,
 * and the later silently replaces the earlier.
 *
 * **Nothing else can say so.** The type permits it — `MetaTag` constrains which of the three
 * identities a tag carries, not whether two tags carry the same one — and `tsc` reports nothing,
 * measured on a probe before this rule was written. There is no runtime diagnostic either, and
 * there cannot usefully be one: by the time the map is built the losing tag has left no trace, and
 * the page that is served looks exactly like a page whose author never wrote it.
 *
 * The `description` shorthand is collected before the `meta` list, so a description written both
 * ways is this fault in its commonest shape — and the one that is lost is the shorthand, which is
 * the line that reads like the page's own description.
 */
export interface HeadTagsCollideIssue {
  /** The class holding the `Head`. */
  component: string;
  /** The identity both tags resolve to — `name="robots"`, `rel="icon" href="/icon.png"`. */
  identity: string;
  /** The entry that is lost, as a reader would point at it — a `meta`, a `link`, the shorthand. */
  lost: string;
  /** The line holding the entry that replaces it, so a reader can see both. */
  replacedAtLine: number;
  /**
   * The LOST entry's position, not the winner's.
   *
   * Which of the two to point at was decided by reading the output rather than the rule: the line
   * a reader has to open is the one that does nothing, because the other one is working as
   * written and there is nothing to change about it.
   */
  file: string;
  line: number;
  column: number;
}

/** One tag as this rule managed to read it: what identifies it, and everything it carries. */
interface ReadTag {
  /** The identity, or `undefined` when it cannot be proved — which means the tag is not judged. */
  identity?: string;
  /** How the report names it. */
  written: string;
  /**
   * Every property as `name=value`, when all of them are literals.
   *
   * `undefined` means at least one could not be read, which is what decides the one exception:
   * two tags that are byte-identical lose nothing by collapsing, and only a tag this can read
   * whole can be proved identical to another.
   */
  fields?: string;
  at: ts.Node;
}

/** The attributes that identify a `<meta>`, in the order `Head` itself checks them. */
const META_IDENTITY: readonly (readonly [string, string])[] = [
  ["name", "name"],
  ["property", "property"],
  ["httpEquiv", "http-equiv"],
];

/** A property's value when it is a plain string literal, and `undefined` when it is anything else. */
function literal(property: ts.ObjectLiteralElementLike): string | undefined {
  if (!ts.isPropertyAssignment(property)) return undefined;
  const value = property.initializer;
  return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) ? value.text : undefined;
}

function nameOf(property: ts.ObjectLiteralElementLike): string | undefined {
  const key = property.name;
  if (key === undefined) return undefined;
  if (ts.isIdentifier(key)) return key.text;
  if (ts.isStringLiteral(key)) return key.text;
  return undefined;
}

/**
 * One object literal in a `meta` or `link` list.
 *
 * A SPREAD anywhere in it gives up on the whole tag: it may carry the very attribute that decides
 * the identity, and nothing static can say whether it does. Same for a computed key — an entry
 * this cannot read whole is an entry it says nothing about.
 */
function readTag(node: ts.Expression, kind: "meta" | "link"): ReadTag | undefined {
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  if (node.properties.some((property) => ts.isSpreadAssignment(property))) {
    return { written: `a \`${kind}\` entry`, at: node };
  }

  const values = new Map<string, string | undefined>();
  for (const property of node.properties) {
    const key = nameOf(property);
    if (key === undefined) return { written: `a \`${kind}\` entry`, at: node };
    values.set(key, literal(property));
  }

  const readable = [...values.values()].every((value) => value !== undefined);
  const fields = readable
    ? [...values.entries()]
        .map(([key, value]) => `${key}=${value}`)
        .sort()
        .join(" ")
    : undefined;

  if (kind === "link") {
    const rel = values.get("rel");
    const href = values.get("href");
    if (rel === undefined || href === undefined) return { written: "a `link`", fields, at: node };
    return { identity: `rel="${rel}" href="${href}"`, written: "this `link`", fields, at: node };
  }

  for (const [key, attribute] of META_IDENTITY) {
    if (!values.has(key)) continue;
    const value = values.get(key);
    // Written but unreadable: the tag HAS this identity and nothing can say which one, so it is
    // not judged — rather than falling through to the next attribute, which would give it an
    // identity `Head` will never use for it.
    if (value === undefined) return { written: `a \`meta\` with a computed \`${key}\``, fields, at: node };
    return { identity: `${attribute}="${value}"`, written: "this `meta`", fields, at: node };
  }
  // No identity at all is RMD043's business, and `MetaTag` refuses it in a typed build.
  return { written: "a `meta` with nothing to identify it", fields, at: node };
}

/** The array a `meta` or `link` property holds, when it is written as a list on the spot. */
function listOf(options: ts.ObjectLiteralExpression, key: string): readonly ts.Expression[] | undefined {
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property) || nameOf(property) !== key) continue;
    const value = property.initializer;
    if (!ts.isArrayLiteralExpression(value)) return undefined;
    return value.elements;
  }
  return undefined;
}

/**
 * The options object a `this.use(Head, …)` was given.
 *
 * The documented spelling is a factory returning one, and it is followed through a block body's single
 * `return` too, because that is what an author writes when the options need a line of setup first. An
 * object written on the spot is still read: it does not compile and it throws (RMD055), but this rule
 * looks at source, and source under migration is exactly where a report is worth having.
 */
function optionsOf(argument: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined {
  if (argument === undefined) return undefined;
  if (ts.isObjectLiteralExpression(argument)) return argument;
  if (ts.isParenthesizedExpression(argument)) return optionsOf(argument.expression);
  if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
    const body = argument.body;
    if (!ts.isBlock(body)) return optionsOf(body);
    const returned = body.statements.find(ts.isReturnStatement);
    return returned?.expression ? optionsOf(returned.expression) : undefined;
  }
  return undefined;
}

/**
 * Two tags in one `Head` that resolve to the same one.
 *
 * A WARNING, which is this repository's rule for a new rule: one version that says so, the next
 * that refuses. Nothing in this repository trips it — measured across every app and package.
 */
export const headTagsCollide = {
  id: "head-tags-collide",

  report: {
    severity: "warn",
    reportedWhen: "two tags in one `Head` resolve to the same identity, so only the second is written",
    heading: (found) => `${found.length} head tag(s) written twice and served once:`,
    // Naming both entries was the first version, and reading what it printed killed it: for the
    // commonest case it said `a meta name="robots" and a meta name="robots" are both
    // name="robots"` — the same fact three times, and never the two LINES, which is the one thing
    // a reader cannot get from anywhere else.
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> — ${issue.lost} never reaches the page: \`${issue.identity}\` is`,
      `    written again on line ${issue.replacedAtLine}, and the later one wins.`,
    ],
    advice:
      "`Head` keys the tags it writes by what identifies them — a `meta` by `name`, `property` or\n" +
      "`http-equiv`, a `link` by `rel` and `href` — so that an update REPLACES a tag rather than\n" +
      "appending a second copy. Two entries with one identity are therefore one tag, and the later\n" +
      "silently wins.\n\n" +
      "Keep the one you meant and delete the other. If both are meant, give them identities that\n" +
      "differ: `name` and `property` are two attributes and never collide, even when they spell the\n" +
      "same word, and two `link` entries differ as soon as their `href` does.\n\n" +
      "`description` is a shorthand for the meta tag named `description`, and it is collected FIRST,\n" +
      "so writing both loses the shorthand — which is usually the line that was meant.\n\n" +
      "Two byte-identical entries are not reported: they collapse to the tag they both describe and\n" +
      "nothing is lost.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(cls, { self, resolveLocal }) {
    const found: HeadTagsCollideIssue[] = [];

    /**
     * Every tag one options object contributes, in the order `Head` collects them.
     *
     * Order is the whole point: the map keeps the LAST of each identity, so which entry is lost
     * follows from the order, and `description` going first is why it is the one that loses.
     */
    const judge = (options: ts.ObjectLiteralExpression): void => {
      const tags: ReadTag[] = [];

      const description = options.properties.find(
        (property) => ts.isPropertyAssignment(property) && nameOf(property) === "description",
      );
      if (description !== undefined) {
        const value = literal(description);
        tags.push({
          identity: 'name="description"',
          written: "the `description` shorthand",
          ...(value === undefined ? {} : { fields: `content=${value} name=description` }),
          at: description,
        });
      }

      for (const element of listOf(options, "meta") ?? []) {
        const tag = readTag(element, "meta");
        if (tag) tags.push(tag);
      }
      for (const element of listOf(options, "link") ?? []) {
        const tag = readTag(element, "link");
        if (tag) tags.push(tag);
      }

      const seen = new Map<string, ReadTag>();
      for (const tag of tags) {
        if (tag.identity === undefined) continue;
        const earlier = seen.get(tag.identity);
        seen.set(tag.identity, tag);
        if (earlier === undefined) continue;
        // Byte for byte the same tag: it collapses onto itself and nothing is lost. Proving that
        // needs BOTH read whole, which is why an unreadable field is not the same as an absent one.
        if (earlier.fields !== undefined && earlier.fields === tag.fields) continue;
        found.push({
          component: self.name,
          identity: tag.identity,
          lost: earlier.written,
          replacedAtLine: positionOf(tag.at).line,
          ...positionOf(earlier.at),
        });
      }
    };

    ts.forEachChild(cls, function look(node) {
      if (ts.isCallExpression(node) && isThisUse(node)) {
        const hook = node.arguments[0];
        const isHead =
          hook !== undefined && ts.isIdentifier(hook) && hook.text === "Head" && importedFromCore(hook, resolveLocal);
        if (isHead) {
          const options = optionsOf(node.arguments[1]);
          if (options !== undefined) judge(options);
        }
      }
      ts.forEachChild(node, look);
    });

    return found;
  },
} as const satisfies Rule<HeadTagsCollideIssue>;
