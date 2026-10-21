import ts from "typescript";
import { isNothing } from "./element";
import { unwrap } from "./follow-value";
import { FORM_ATTRIBUTES, type ComponentSite } from "./formTable";
import type { ProjectRule } from "./rule";

export interface FormFieldWithoutWhatTheFormNeedsIssue {
  /**
   * `missing` — a field inside a `@ramonda/form` form is written without one of the attributes the
   * form needs; `not-passed` — a component used inside such a form is not handed a prop a field in
   * it is written with; `bag-overrides` — what is handed for a spread written last on a field sets
   * one of those attributes to nothing; `bag-unreadable` — what is handed for it cannot be read;
   * `unreadable-component` — a component used inside such a form whose render this cannot read;
   * `form-not-attached` — a component holds a `Form` and renders no `<form onsubmit={this.X.submit}>`
   * for it; `form-in-a-hook` — a hook holds a `Form`, which no form can be recognised through.
   */
  kind:
    | "missing"
    | "not-passed"
    | "bag-overrides"
    | "bag-unreadable"
    | "unreadable-component"
    | "form-not-attached"
    | "form-in-a-hook";
  /** The component or tag the report is about. */
  component: string;
  /** The attributes, prop or field the report names. */
  detail: string;
  file: string;
  line: number;
  column: number;
}

/** The names a field's form attributes may be handed under, in a spread written last on it. */
const FORM_KEYS = new Set(["name", "value", "checked", "oninput", "onchange", "onblur", "aria-invalid"]);

/** `this.props.P`, as written — the name, or `undefined`. */
function propRead(expression: ts.Expression | undefined): string | undefined {
  if (expression === undefined) return undefined;
  const written = unwrap(expression);
  if (!ts.isPropertyAccessExpression(written)) return undefined;
  const object = unwrap(written.expression);
  if (!ts.isPropertyAccessExpression(object) || object.name.text !== "props") return undefined;
  return object.expression.kind === ts.SyntaxKind.ThisKeyword ? written.name.text : undefined;
}

/**
 * A field inside a `@ramonda/form` form, written without everything the form needs.
 *
 * The form is recognised by one shape: `<form onsubmit={this.X.submit}>`, where `X` is a field of the
 * same class initialised `this.use(Form, …)` and `Form` is imported from `@ramonda/form`. Every
 * controlled field inside it — written in that render, in a component rendered there (followed
 * through every component it renders), or handed as children to a component that places its children
 * inside one — is written with all five of `name`, `value` (`checked` on a box), `oninput`, `onblur`
 * and `aria-invalid`, each by name.
 *
 * A component that takes them as props — a design system's `StyledInput`, writing
 * `name={this.props.name}` — is checked where it is USED inside a form: every use there hands each of
 * those props. One spread on the field written AFTER them, the usual way to let a caller overwrite a
 * default, is checked the same way: every use inside a form hands it as an object written there, and
 * sets none of them to nothing.
 *
 * Reported as well, since a form this cannot recognise is a form whose fields this cannot check: a
 * component that holds a `Form` and renders no `<form onsubmit={this.X.submit}>` for it, a hook that
 * holds one, and a component used inside a form whose render this cannot read.
 */
export const formFieldWithoutWhatTheFormNeeds = {
  id: "form-field-without-what-the-form-needs",

  report: {
    severity: "error",
    reportedWhen:
      "a field inside a `@ramonda/form` form is written without `name`, `value`, `oninput`, `onblur` or " +
      "`aria-invalid`, a component used there is not handed one of them, or the form cannot be recognised",
    heading: (found) => `${found.length} field(s) or form(s) without what @ramonda/form needs:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> ${
        {
          missing: `is inside a @ramonda/form form and is written without ${issue.detail}.`,
          "not-passed": `is used inside a @ramonda/form form and is not handed \`${issue.detail}\`, which a field in it is written with.`,
          "bag-overrides": `is handed \`${issue.detail}\` set to nothing, in what a field in it spreads last.`,
          "bag-unreadable": `is handed \`${issue.detail}\` as something this cannot read — a field in it spreads it last, over its form attributes.`,
          "unreadable-component":
            "is used inside a @ramonda/form form, and its render cannot be read to check its fields.",
          "form-not-attached": `holds a Form in \`${issue.detail}\` and renders no <form onsubmit={this.${issue.detail}.submit}>.`,
          "form-in-a-hook": `is a hook holding a Form in \`${issue.detail}\`; a form is recognised only where a component holds it.`,
        }[issue.kind]
      }`,
    ],
    advice:
      "A field inside a @ramonda/form form is written with each attribute the form needs, by name:\n\n" +
      "```tsx\n" +
      "const email = this.form.fields.email.$;\n\n" +
      "<input\n" +
      "  name={email.name}\n" +
      "  value={email.inputValue}\n" +
      "  oninput={email.oninput}\n" +
      "  onblur={email.onblur}\n" +
      "  aria-invalid={email.invalid}\n" +
      "/>\n" +
      "```\n\n" +
      "The form is the one in `<form onsubmit={this.form.submit}>`, where `form = this.use(Form, …)`.\n" +
      "A component that takes the attributes as props is handed every one of them wherever it is used\n" +
      "inside a form.\n\n",
  },

  read(project) {
    const { fields, sites, holders } = project.forms;
    const found: FormFieldWithoutWhatTheFormNeedsIssue[] = [];

    for (const holder of holders) {
      if (holder.isHook)
        found.push({ kind: "form-in-a-hook", component: holder.component, detail: "form", ...where(holder) });
      else if (!holder.attached)
        found.push({ kind: "form-not-attached", component: holder.component, detail: "form", ...where(holder) });
    }

    // Every class rendered inside a form, through every component it renders in turn.
    const inForm = new Set<ts.ClassLikeDeclaration>();
    const inContext = (owner: ts.ClassLikeDeclaration | undefined, local: boolean) =>
      local || (owner !== undefined && inForm.has(owner));
    for (let grew = true; grew; ) {
      grew = false;
      for (const site of sites) {
        if (site.target !== undefined && !inForm.has(site.target) && inContext(site.owner, site.inForm)) {
          inForm.add(site.target);
          grew = true;
        }
      }
    }
    for (const site of sites) {
      if (site.target === undefined && inContext(site.owner, site.inForm)) {
        found.push({ kind: "unreadable-component", component: site.tag, detail: site.tag, ...where(site) });
      }
    }

    // What the fields inside a form need from the components that write them.
    const queue: { owner: ts.ClassLikeDeclaration; name: string; bag: boolean }[] = [];
    const seen = new Set<string>();
    const ids = new Map<ts.ClassLikeDeclaration, number>();
    const need = (owner: ts.ClassLikeDeclaration | undefined, name: string, bag: boolean) => {
      if (owner === undefined) return;
      if (!ids.has(owner)) ids.set(owner, ids.size);
      const key = `${ids.get(owner)}|${name}|${bag}`;
      if (seen.has(key)) return;
      seen.add(key);
      queue.push({ owner, name, bag });
    };

    for (const field of fields) {
      if (!inContext(field.owner, field.inForm)) continue;
      const missing = FORM_ATTRIBUTES.filter((name) => field.attributes[name].kind === "missing");
      if (missing.length > 0) {
        found.push({
          kind: "missing",
          component: field.tag,
          detail: missing.map((name) => `\`${name}\``).join(", "),
          ...where(field),
        });
      }
      for (const name of FORM_ATTRIBUTES) {
        const source = field.attributes[name];
        if (source.kind === "prop") need(field.owner, source.prop, false);
      }
      for (const bag of field.lateBags) need(field.owner, bag, true);
    }

    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const { owner, name, bag } = next;
      for (const site of sites) {
        if (site.target !== owner || !inContext(site.owner, site.inForm)) continue;
        const handed = site.props.get(name);
        if (!site.props.has(name)) {
          if (!bag) found.push({ kind: "not-passed", component: site.tag, detail: name, ...where(site) });
          continue;
        }
        if (handed === undefined) continue;
        const prop = propRead(handed);
        if (prop !== undefined) {
          need(site.owner, prop, bag);
          continue;
        }
        if (!bag) {
          if (isNothing(handed)) found.push({ kind: "not-passed", component: site.tag, detail: name, ...where(site) });
          continue;
        }
        readBag(handed, site, name, found);
      }
    }

    return found;
  },
} as const satisfies ProjectRule<FormFieldWithoutWhatTheFormNeedsIssue>;

/** What a site hands for a spread written last on a field: an object written there, setting nothing to nothing. */
function readBag(
  handed: ts.Expression,
  site: ComponentSite,
  name: string,
  found: FormFieldWithoutWhatTheFormNeedsIssue[],
): void {
  const written = unwrap(handed);
  if (!ts.isObjectLiteralExpression(written)) {
    found.push({ kind: "bag-unreadable", component: site.tag, detail: name, ...where(site) });
    return;
  }
  for (const property of written.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      found.push({ kind: "bag-unreadable", component: site.tag, detail: name, ...where(site) });
      return;
    }
    const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined;
    if (key === undefined) {
      found.push({ kind: "bag-unreadable", component: site.tag, detail: name, ...where(site) });
      return;
    }
    if (FORM_KEYS.has(key) && ts.isPropertyAssignment(property) && isNothing(property.initializer)) {
      found.push({ kind: "bag-overrides", component: site.tag, detail: `${name}.${key}`, ...where(site) });
    }
  }
}

function where(at: { file: string; line: number; column: number }) {
  return { file: at.file, line: at.line, column: at.column };
}
