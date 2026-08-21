import ts from "typescript";
import { positionOf } from "../syntax";
import { openingOf, tagOf } from "./element";
import { follow, type Looking } from "./follow-value";
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
 * Both spellings of the label association are here — `for` as HTML writes it, `htmlFor` as the JSX
 * borrows it. They were not equivalent while these rules were being written; see
 * {@link LABELS_A_CONTROL} for what was measured and what core now does about it.
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

/**
 * The attributes that point a label at a control, shared by the two rules that ask.
 *
 * **Both spellings, and that is newer than it looks.** `htmlFor` used to associate nothing: an HTML
 * attribute is written through `setAttribute`, which lowercases the name, and core special-cased
 * `className` into `class` while having no such case for its twin. Measured while these rules were
 * being written — `<label htmlFor="a">` rendered `htmlfor="a"` and `label.htmlFor` read `""` — and
 * core now implements the pair the documentation had always described as one rule.
 */
export const LABELS_A_CONTROL: ReadonlySet<string> = new Set(["for", "htmlFor"]);

/**
 * `input` types that carry their own name, or have no name to carry.
 *
 * `submit`, `reset` and `button` are named by their `value`, and by a browser default when there is
 * none — so they are never nameless. `hidden` is not rendered at all. `image` is named by its `alt`,
 * which is `unnamed-image`'s subject and not these rules'.
 */
export const NAMES_ITSELF: ReadonlySet<string> = new Set(["submit", "reset", "button", "hidden", "image"]);

/**
 * The elements a reader has to be told the purpose of, because nothing about them says it.
 *
 * HTML's labelable elements, minus `button`. A button is named by what is INSIDE it — the text on
 * it is its name — so a button with content is never nameless, and one with none is an empty
 * element rather than an unlabelled control.
 *
 * `meter`, `progress` and `output` are here for the reason the other three are: each renders a
 * value and nothing else, so a reader is told "50%" with no word for what is at 50%. They are
 * labelable exactly as an `<input>` is, and every way of naming one is the same way.
 */
const CONTROLS: ReadonlySet<string> = new Set(["input", "select", "textarea", "meter", "progress", "output"]);

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

/**
 * What a JSX attribute's value says, when it says anything this can read in full.
 *
 * A NAME is followed to its declaration, exactly as `attr` follows one, and for a reason this table
 * feels harder than the per-element family does: keeping ids in one module is the ordinary way to
 * make two references agree, and reading only the literal turned that into a project-wide silence.
 * Measured with `fixtures/id-table-hop` — one `<h2 id={SUMMARY_ID}>` marked the project's ids
 * unreadable, and a mistyped `aria-labelledby` and a fragment link to nowhere in the same file were
 * both reported by nothing.
 */
function literalOf(
  value: ts.JsxAttributeValue | undefined,
  resolve: (id: ts.Node) => ts.Symbol | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  if (ts.isStringLiteral(value)) return value.text;
  if (ts.isJsxExpression(value) && value.expression !== undefined) {
    // A template with no substitutions is a literal that happens to be written in backticks, and
    // `literal` covers it; anything else has to settle on ONE answer or it is not read at all.
    return follow(value.expression, resolve, LITERAL)?.value;
  }
  return undefined;
}

/**
 * The same boundaries the element family's reader takes, and they matter more here.
 *
 * A branch or a call has no single answer, and this table's answer is used to say an id EXISTS —
 * so a guess would silence a real report rather than cause a false one, which is the quieter and
 * worse direction. A module `const` is one answer written once and counts.
 */
const LITERAL: Looking<string> = {
  leaf: (expression) => (ts.isStringLiteralLike(expression) ? expression.text : undefined),
  throughModuleScope: true,
  throughBranches: false,
  throughCalls: false,
  throughMutableBindings: false,
};

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
export function idTableFor(
  sources: readonly ts.SourceFile[],
  resolve: (id: ts.Node) => ts.Symbol | undefined,
): ProjectContext {
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
        const written = literalOf(attribute.initializer, resolve);
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
        const written = literalOf(attribute.initializer, resolve);
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
        const written = literalOf(attribute.initializer, resolve);
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

      if (name === "type") type = literalOf(attribute.initializer, resolve)?.toLowerCase();
      else if (name === "id") {
        const written = literalOf(attribute.initializer, resolve);
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

  /**
   * An id written in `@Host` props, which is on the page and is in no JSX element.
   *
   * `@Host("section", () => ({ id: "overview" }))` puts `id="overview"` on the component's own host
   * — a real id that a fragment link resolves against and that nothing in any render shows. The
   * table used to miss it entirely, so `<a href="#overview">` was reported as going nowhere.
   * Measured with a plant, and the shape got likelier the day `@Host`'s props became typed as the
   * element's attributes.
   *
   * An id here that cannot be READ silences the family, exactly as an unreadable one on a host
   * element in JSX does — it is the same kind of claim about the same kind of element.
   */
  const readHostProps = (cls: ts.ClassLikeDeclaration): void => {
    for (const decorator of ts.getDecorators(cls) ?? []) {
      const call = decorator.expression;
      if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== "Host") continue;

      const written = call.arguments[1];
      if (written === undefined) continue;
      if (!ts.isArrowFunction(written) && !ts.isFunctionExpression(written)) continue;

      /**
       * Both bodies a props callback is written with: `() => ({ id })` and `() => { return { id } }`.
       *
       * Reading only the concise one left the second spelling missing — found in review by planting
       * it, after the concise one had already been fixed. A block with anything other than one
       * `return` of an object literal is not read: what it hands back is a value, and that is the
       * dataflow this package refuses.
       */
      const returned = ts.isBlock(written.body)
        ? written.body.statements.length === 1 && ts.isReturnStatement(written.body.statements[0])
          ? written.body.statements[0].expression
          : undefined
        : written.body;
      const object = returned !== undefined && ts.isParenthesizedExpression(returned) ? returned.expression : returned;
      if (object === undefined || !ts.isObjectLiteralExpression(object)) continue;

      for (const property of object.properties) {
        /**
         * `({ id: OVERVIEW_ID })` and `({ id })`, which are the same claim.
         *
         * The shorthand was read by nothing — not even as an unreadable id — so an id the page
         * really carries was missing from the table, and a reference to it would have been
         * reported as naming nothing. Planted after the long form was fixed, on the standing
         * lesson that a fix for one spelling is not a fix for the other.
         */
        const shorthand = ts.isShorthandPropertyAssignment(property);
        if (!ts.isPropertyAssignment(property) && !shorthand) continue;
        const key =
          ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined;
        if (key?.toLowerCase() !== "id") continue;

        const value = shorthand ? property.name : property.initializer;
        if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
          ids.add(value.text);
          continue;
        }
        if (ts.isTemplateExpression(value) && value.head.text.length > 0) {
          prefixes.push(value.head.text);
          continue;
        }
        // A name holding the id — the same hop the JSX reader above takes.
        const behind = follow(value, resolve, LITERAL)?.value;
        if (behind !== undefined) {
          ids.add(behind);
          continue;
        }
        unreadable.push({ written: property.getText(), ...positionOf(property) });
      }
    }
  };

  const walk = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) readElement(node);
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) readHostProps(node);
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
  /**
   * The one quadratic path in the package — references × prefixes — and it is measured rather than
   * feared.
   *
   * Its worst case is a project where every id is a template and every reference resolves to
   * nothing, so every scan runs to the end. Generated at 4,000 components: 8,000 references against
   * 4,000 prefixes, 32 million comparisons, and the WHOLE run was 1.5 s and still linear against the
   * component count. A prefix fails on its first character, which is why.
   *
   * Written down so the shape is not a surprise if a project ever arrives that is large enough for
   * it to matter. The fix at that point is a trie, not a rewrite.
   */
  return project.prefixes.some((prefix) => target.startsWith(prefix));
}
