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
   * `bag-without-a-handler` — what is handed for it carries a `value` (`checked`) and no handler, on
   * a field that writes none of its own;
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

/**
 * What a spread must carry beside its model: `nothing` when the field writes its own handler; on a
 * `text` field an `oninput` beside a `value`; on a `pick` (a select) either handler beside a `value`;
 * on a `box` either handler beside a `checked` — its `value` is only what the form sends.
 */
type Wants = "nothing" | "text" | "pick" | "box";

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
 * those props, by name or through a spread whose type names it — not one it may leave out, as
 * `name?: string` may. A wrapper that hands its own props on, `<StyledInput {...this.props} />`, is
 * checked where IT is used, as `name={this.props.name}` is. A spread of a prop on a field, `{...this.props.attrs}` — the usual way to let a caller
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
      // Named by the field that holds it, which the report's advice writes as `this.<field>.submit`.
      const detail = holder.fields[0] ?? "form";
      if (holder.isHook) found.push({ kind: "form-in-a-hook", component: holder.component, detail, ...where(holder) });
      else if (!holder.attached)
        found.push({ kind: "form-not-attached", component: holder.component, detail, ...where(holder) });
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
    // `wants`: for a spread, what it must carry beside a `value` — nothing when the field writes its own
    // handler, `oninput` on a text field, whose `change` comes on blur, and either on a pick.
    const queue: {
      owner: ts.ClassLikeDeclaration;
      name: string;
      bag: boolean;
      wants: Wants;
      // For a spread, what the field writes after it, which the spread cannot override.
      shadowed: readonly string[];
    }[] = [];
    const seen = new Set<string>();
    const ids = new Map<ts.ClassLikeDeclaration, number>();
    const need = (
      owner: ts.ClassLikeDeclaration | undefined,
      name: string,
      bag: boolean,
      wants: Wants = "nothing",
      shadowed: readonly string[] = [],
    ) => {
      if (owner === undefined) return;
      if (!ids.has(owner)) ids.set(owner, ids.size);
      const key = `${ids.get(owner)}|${name}|${bag}|${wants}|${shadowed.join(",")}`;
      if (seen.has(key)) return;
      seen.add(key);
      queue.push({ owner, name, bag, wants, shadowed });
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
    for (const bag of bags) {
      const wants: Wants = bag.handled ? "nothing" : bag.box ? "box" : bag.pick ? "pick" : "text";
      need(bag.owner, bag.prop, true, wants, bag.shadowed);
    }

    // Each use by the component it renders: an item is asked of its own uses, not of every use there is.
    const usesOf = new Map<unknown, typeof sites>();
    for (const site of sites) {
      const uses = usesOf.get(site.target);
      if (uses === undefined) usesOf.set(site.target, [site]);
      else uses.push(site);
    }
    // Walked by its index, as `need` adds to it: no array shifted under every item.
    for (let at = 0; at < queue.length; at++) {
      const { owner, name, bag, wants, shadowed } = queue[at];
      for (const site of usesOf.get(owner) ?? []) {
        // What a field needs from a form is asked inside one; what a spread on it carries, everywhere.
        if (!bag && !inContext(site.owner, site.inForm)) continue;
        const handed = site.props.get(name);
        if (!site.props.has(name)) {
          // A bag that may come through a spread is not written here, and cannot be read.
          if (bag && (site.spreadMayHand === undefined || site.spreadMayHand.has(name)))
            found.push({ kind: "bag-unreadable", component: site.tag, detail: name, ...where(site) });
          // Handed through a spread whose type names it, not as one it may leave out: `<StyledInput {...email} />`.
          else if (!bag && site.spreadHands.has(name)) continue;
          // Handed through the owner's own props, `{...this.props}`: asked of the owner's uses.
          else if (site.spreadsOwnProps) need(site.owner, name, bag, wants, shadowed);
          // Not handed — nor surely by a spread, one that may leave it out or whose type cannot be read.
          else if (!bag) found.push({ kind: "not-passed", component: site.tag, detail: name, ...where(site) });
          continue;
        }
        if (handed === undefined) continue;
        const prop = propRead(handed);
        if (prop !== undefined) {
          need(site.owner, prop, bag, wants, shadowed);
          continue;
        }
        if (!bag) {
          if (holdsNothing(handed))
            found.push({ kind: "not-passed", component: site.tag, detail: name, ...where(site) });
          continue;
        }
        readBag(handed, site, name, wants, shadowed, holdsNothing, found);
      }
    }

    // One prop spread on more than one field is asked once for each — what it wants differs — and its
    // bag is read at each use as many times: one report says it.
    const said = new Set<string>();
    return found.filter((issue) => {
      const key = `${issue.kind}|${issue.detail}|${issue.file}|${issue.line}|${issue.column}`;
      if (said.has(key)) return false;
      said.add(key);
      return true;
    });
  },
} as const satisfies ProjectRule<FormFieldWithoutWhatTheFormNeedsIssue>;

/** What a site hands for a spread written last on a field: an object written there, setting nothing to nothing. */
function readBag(
  handed: ts.Expression,
  site: ComponentSite,
  name: string,
  wants: Wants,
  shadowed: readonly string[],
  holdsNothing: (expression: ts.Expression) => boolean,
  found: FormFieldWithoutWhatTheFormNeedsIssue[],
): void {
  const written = unwrap(handed);
  if (!ts.isObjectLiteralExpression(written)) {
    found.push({ kind: "bag-unreadable", component: site.tag, detail: name, ...where(site) });
    return;
  }
  // The keys the bag sets to something: a key that holds nothing — `{ oninput: undefined }` — carries
  // no handler and sets no model, as core reads it.
  const keys = new Set<string>();
  for (const property of written.properties) {
    // A method written in the bag — `oninput(event) { … }` — is a handler written there, as an arrow is.
    if (ts.isMethodDeclaration(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
      keys.add(property.name.text);
      continue;
    }
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
    if (!holdsNothing(held)) keys.add(key);
    else if (FORM_KEYS.has(key) && !shadowed.includes(key)) {
      found.push({ kind: "bag-overrides", component: site.tag, detail: `${name}.${key}`, ...where(site) });
    }
  }
  // `on:input` is the field's own handler as `oninput` is, however it reaches the field.
  const carries =
    keys.has("oninput") ||
    keys.has("on:input") ||
    (wants !== "text" && (keys.has("onchange") || keys.has("on:change")));
  // A value the field writes after the spread is the field's, whatever the spread says.
  // The model key the spread may set: `checked` on a box, `value` on anything else — and only when the
  // field does not write it after the spread.
  const model = wants === "box" ? "checked" : "value";
  const value = keys.has(model) && !shadowed.includes(model);
  if (wants !== "nothing" && value && !carries) {
    found.push({ kind: "bag-without-a-handler", component: site.tag, detail: name, ...where(site) });
  }
}

function where(at: { file: string; line: number; column: number }) {
  return { file: at.file, line: at.line, column: at.column };
}
