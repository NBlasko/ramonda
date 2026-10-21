import ts from "typescript";
import { unwrap } from "./follow-value";
import { FORM_ATTRIBUTES, propRead, type ComponentSite } from "./formTable";
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
    | "bag-without-a-handler"
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
 * those props. A spread of a prop on a field, `{...this.props.attrs}` — the usual way to let a caller
 * overwrite a default — is checked at every use, inside a form or not: each hands it as an object
 * written there, sets none of the form's attributes to nothing, and hands no `value` (`checked`)
 * without an `oninput` or `onchange` beside it, unless the field writes its own by name. A shorthand,
 * `{ oninput }`, is followed to the `const` it names.
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
          "bag-without-a-handler": `is handed \`${issue.detail}\` with a value and no \`oninput\` or \`onchange\` beside it, so the field it is spread on cannot be changed.`,
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
    const { fields, bags, sites, holders, holdsNothing } = project.forms;
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
    // `handled`: for a spread, whether the field writes its own handler — then a `value` in it has one.
    const queue: { owner: ts.ClassLikeDeclaration; name: string; bag: boolean; handled: boolean }[] = [];
    const seen = new Set<string>();
    const ids = new Map<ts.ClassLikeDeclaration, number>();
    const need = (owner: ts.ClassLikeDeclaration | undefined, name: string, bag: boolean, handled = false) => {
      if (owner === undefined) return;
      if (!ids.has(owner)) ids.set(owner, ids.size);
      const key = `${ids.get(owner)}|${name}|${bag}|${handled}`;
      if (seen.has(key)) return;
      seen.add(key);
      queue.push({ owner, name, bag, handled });
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
    }
    // A spread of props on a field, anywhere: what each use hands for it is read there.
    for (const bag of bags) need(bag.owner, bag.prop, true, bag.handled);

    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const { owner, name, bag, handled } = next;
      for (const site of sites) {
        // What a field needs from a form is asked inside one; what a spread on it carries, everywhere.
        if (site.target !== owner || (!bag && !inContext(site.owner, site.inForm))) continue;
        const handed = site.props.get(name);
        if (!site.props.has(name)) {
          if (!bag) found.push({ kind: "not-passed", component: site.tag, detail: name, ...where(site) });
          continue;
        }
        if (handed === undefined) continue;
        const prop = propRead(handed);
        if (prop !== undefined) {
          need(site.owner, prop, bag, handled);
          continue;
        }
        if (!bag) {
          if (holdsNothing(handed))
            found.push({ kind: "not-passed", component: site.tag, detail: name, ...where(site) });
          continue;
        }
        readBag(handed, site, name, handled, holdsNothing, found);
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
  handled: boolean,
  holdsNothing: (expression: ts.Expression) => boolean,
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
    // `{ oninput }` is `{ oninput: oninput }`, and the name is followed to what it holds.
    const held = ts.isPropertyAssignment(property) ? property.initializer : property.name;
    if (FORM_KEYS.has(key) && holdsNothing(held)) {
      found.push({ kind: "bag-overrides", component: site.tag, detail: `${name}.${key}`, ...where(site) });
    }
  }
  const keys = new Set(
    written.properties.map((p) =>
      p.name !== undefined && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : "",
    ),
  );
  if (!handled && (keys.has("value") || keys.has("checked")) && !keys.has("oninput") && !keys.has("onchange")) {
    found.push({ kind: "bag-without-a-handler", component: site.tag, detail: name, ...where(site) });
  }
}

function where(at: { file: string; line: number; column: number }) {
  return { file: at.file, line: at.line, column: at.column };
}
