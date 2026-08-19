import ts from "typescript";
import { positionOf } from "../syntax";
import { openingOf, tagOf } from "./element";
import { enclosingElement } from "./html";
import type { FormControl, IdReference, ProjectContext, UnreadableId } from "./rule";

/**
 * The project's ids, and every place one is named — the fifth subject, built in one pass.
 *
 * Collected from EVERY JSX element, host tags and components alike. A component matters here for
 * one specific reason that is easy to miss: `<TextField id="email" />` is where the literal lives
 * when the host element inside `TextField` writes `id={this.props.id}`. Reading only host tags
 * would put that project's ids beyond reach while filling `unreadable` with the pass-through, and
 * the table would then be silent about a project that is in fact entirely readable.
 */

/**
 * The attributes that NAME an id.
 *
 * **`for`, not `htmlFor`** — measured through the framework, not assumed. Ramonda gives an HTML
 * element its attributes through `setAttribute`, which lowercases the name, and it special-cases
 * `className` into `class` but has no such case for `htmlFor`. So `<label htmlFor="a">` renders
 * `htmlfor="a"`, `label.htmlFor` reads `""`, and the label is associated with nothing — while
 * `<label for="b">` works. Both typecheck.
 *
 * `htmlFor` is kept in the set anyway, because a rule that ignored it would report the control it
 * was aimed at as unlabelled and say nothing about the reason. It is an ATTEMPT to name something,
 * and the rules treat it as one — see `NOT_A_REAL_ASSOCIATION`.
 */
export const NAMES_AN_ID: ReadonlySet<string> = new Set([
  "for",
  "aria-labelledby",
  "aria-describedby",
  "aria-controls",
  "aria-owns",
  "aria-activedescendant",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "htmlFor",
]);

/** The elements a reader has to be told the purpose of, because nothing about them says it. */
const CONTROLS: ReadonlySet<string> = new Set(["input", "select", "textarea"]);

/** The attributes that give an element a name outright, rather than by pointing at one. */
const NAMES_IT_DIRECTLY: ReadonlySet<string> = new Set(["aria-label", "aria-labelledby", "title"]);

/** Whether a `<label>` encloses this element within the same render. */
function insideALabel(element: ts.JsxElement | ts.JsxSelfClosingElement): boolean {
  let at = enclosingElement(element);
  while (at !== undefined) {
    if (tagOf(at) === "label") return true;
    at = enclosingElement(at);
  }
  return false;
}

/** What a JSX attribute's value says, when it says anything this can read in full. */
function literalOf(value: ts.JsxAttributeValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (ts.isStringLiteral(value)) return value.text;
  if (ts.isJsxExpression(value) && value.expression !== undefined && ts.isStringLiteralLike(value.expression)) {
    // A template with no substitutions is a literal that happens to be written in backticks.
    return value.expression.text;
  }
  return undefined;
}

/**
 * The literal head of a template — `row-` from `` `row-${i}` ``.
 *
 * `undefined` when the template begins with a substitution, which can produce anything and so
 * proves nothing about what the id may be.
 */
function prefixOf(value: ts.JsxAttributeValue | undefined): string | undefined {
  if (value === undefined || !ts.isJsxExpression(value) || value.expression === undefined) return undefined;
  const written = value.expression;
  if (!ts.isTemplateExpression(written)) return undefined;
  return written.head.text.length > 0 ? written.head.text : undefined;
}

/** Builds the table. One walk of every file, whatever rules end up asking about it. */
export function idTableFor(sources: readonly ts.SourceFile[]): ProjectContext {
  const ids = new Set<string>();
  const prefixes: string[] = [];
  const unreadable: UnreadableId[] = [];
  const references: IdReference[] = [];
  const controls: FormControl[] = [];

  const readElement = (element: ts.JsxElement | ts.JsxSelfClosingElement): void => {
    const opening = openingOf(element);
    const hostTag = tagOf(element);
    // A component tag reads as `undefined`; its own name is what a report shows.
    const tag = hostTag ?? opening.tagName.getText();

    /**
     * A spreading element is not asked about its own references, and does not silence the table.
     *
     * The first half is the stance the per-element family already takes: a spread may carry the
     * very attribute a rule is about. The second half is the line this family draws and the note on
     * `ProjectContext.unreadable` defends — measured, counting a spread as an unreadable id would
     * have silenced every rule here in every project in this repository.
     */
    if (opening.attributes.properties.some(ts.isJsxSpreadAttribute)) return;

    if (hostTag !== undefined && CONTROLS.has(hostTag)) readControl(element, hostTag);

    for (const attribute of opening.attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) continue;

      const name = attribute.name.getText();

      if (name.toLowerCase() === "id") {
        const written = literalOf(attribute.initializer);
        if (written !== undefined) {
          ids.add(written);
          continue;
        }
        const prefix = prefixOf(attribute.initializer);
        if (prefix !== undefined) {
          prefixes.push(prefix);
          continue;
        }

        /**
         * An `id` this cannot read silences the whole family — but only on a HOST element.
         *
         * Found by running the first version of this table against `apps/docs`, where both rules
         * went silent over `<ProfileCard id={this.id} />`. That `id` is a profile's id: it is handed
         * to `getProfile()` and never touches the DOM. A prop happening to be called `id` had
         * switched off two rules across the entire project.
         *
         * Nothing is lost by the narrowing, which is what makes it safe rather than convenient. A
         * component's `id` prop reaches the document only if that component writes it onto a host
         * element — and that host element is in the source too, where `id={this.props.id}` is
         * unreadable on its own terms and silences the family there. The pass-through is still
         * caught; only the data field is not.
         *
         * A LITERAL `id` on a component goes into the table above regardless, because widening the
         * set of known ids can only prevent a false report and never cause one.
         */
        if (hostTag !== undefined) {
          unreadable.push({ written: attribute.getText(), ...positionOf(attribute) });
        }
        continue;
      }

      if (NAMES_AN_ID.has(name) || NAMES_AN_ID.has(name.toLowerCase())) {
        const written = literalOf(attribute.initializer);
        if (written === undefined) continue;
        // `aria-labelledby` takes a LIST of ids, space-separated, and every one of them is a
        // reference. Reading it as a single id would report a working pair as missing.
        for (const target of written.split(/\s+/).filter((one) => one.length > 0)) {
          references.push({ attribute: name, target, tag, ...positionOf(attribute) });
        }
        continue;
      }

      // A fragment link — `href="#pricing"`. `#` alone is `link-without-a-destination`'s business.
      if (name.toLowerCase() === "href" && tag === "a") {
        const written = literalOf(attribute.initializer);
        if (written === undefined || !written.startsWith("#") || written.length === 1) continue;
        references.push({ attribute: name, target: written.slice(1), tag, ...positionOf(attribute) });
      }
    }
  };

  /** What the walk can see about how a control might be named. The judgement is the rule's. */
  const readControl = (element: ts.JsxElement | ts.JsxSelfClosingElement, tag: string): void => {
    const opening = openingOf(element);

    let type: string | undefined;
    let id: string | undefined;
    let opaqueId = false;
    let namingAttribute = false;
    let placeholder = false;

    for (const attribute of opening.attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) continue;
      const name = attribute.name.getText().toLowerCase();

      if (name === "type") type = literalOf(attribute.initializer)?.toLowerCase();
      else if (name === "id") {
        const written = literalOf(attribute.initializer);
        if (written === undefined) opaqueId = true;
        else id = written;
      } else if (name === "placeholder") placeholder = true;
      else if (NAMES_IT_DIRECTLY.has(name)) {
        // Written at all, in any form. `aria-label={t("email")}` is somebody naming this control,
        // and whether the string is empty is not a question this can answer.
        namingAttribute = true;
      }
    }

    controls.push({
      tag,
      type,
      id,
      opaqueId,
      namingAttribute,
      placeholder,
      insideALabel: insideALabel(element),
      ...positionOf(opening),
    });
  };

  const walk = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) readElement(node);
    ts.forEachChild(node, walk);
  };

  for (const file of sources) walk(file);

  return { ids, prefixes, unreadable, references, controls };
}

/**
 * Whether the project could possibly define this id.
 *
 * Written once, here, rather than in each rule — the two rules in this family ask exactly the same
 * question and a second spelling of it is a second answer waiting to happen.
 */
export function couldExist(target: string, project: ProjectContext): boolean {
  if (project.ids.has(target)) return true;
  return project.prefixes.some((prefix) => target.startsWith(prefix));
}
