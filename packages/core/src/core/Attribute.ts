import type { EnhancedHTMLNode } from "../types/vdom";
import { IS_SVG, KEY_SYM, STYLE_SYM, REF_SYM, BOOLEAN_ATTRIBUTES, keptInAProperty } from "../helpers/constants";
import { checkBooleanAttribute } from "../debug/booleanAttribute";
import {
  INPUT_OWN_EVENTS,
  composingIn,
  controlInput,
  groupOf,
  heldByAModel,
  keepOwnHandler,
  showsTheModel,
} from "./field";
import { queueBeforeTheMounts } from "./commit";
type NodeAttributes = Record<string, any>;

/**
 * `onServer` skips attaching event listeners, which a server render has no use for.
 *
 * Read from the OWNING COMPONENT's runtime by the caller, not from `getRenderEnv()`. That module-level
 * flag has a contract — only `createComponent` may read it, and only for a root mount — because it is
 * restored before the first `await` and a re-render drained later would see "client" whatever side it
 * is really on. The runtime's `env` is inherited down the tree and stays correct through the drain.
 *
 * Passed as a parameter rather than looked up per attribute: it is one property read per ELEMENT, and
 * the loop below runs per attribute.
 */
export function applyChangesOnAttributes(enhancedNode: ChildNode, rawNextAttributes: NodeAttributes, onServer = false) {
  if (!("tagName" in enhancedNode)) return;

  const previousAttributes = getAllFromNode(enhancedNode as EnhancedHTMLNode);
  const nextAttributes = formatAttributes(rawNextAttributes);
  removePreviousFromenhancedNode(enhancedNode as EnhancedHTMLNode, previousAttributes, nextAttributes);
  attachNextOnenhancedNode(enhancedNode as EnhancedHTMLNode, previousAttributes, nextAttributes, onServer);
  releaseDroppedRef(enhancedNode as EnhancedHTMLNode, nextAttributes.ref);
  /**
   * An `<input>` is told, on every pass, whether it is controlled — a pass that no longer has a
   * `value` lets the field go, which the attribute diff, reading attributes back off the element,
   * would never see.
   */
  if (enhancedNode.nodeName === "INPUT") {
    writeDefaults(enhancedNode as unknown as HTMLInputElement, rawNextAttributes, onServer);
    if (!onServer) controlInput(enhancedNode as unknown as HTMLInputElement, rawNextAttributes);
  }
}

/**
 * `defaultValue` and `defaultChecked` on an `<input>`: where an uncontrolled field STARTS, and nothing
 * more. Written as the attribute HTML keeps a default in — `value`, or `checked` — which the property
 * follows until the user edits and a form's reset returns to, on both sides, so a served page starts
 * on it before any script runs. Nothing writes the property: the field is the user's.
 *
 * Here rather than in the attribute loop, because neither is an attribute of its own name for the
 * diff to read back, so a default taken away — `defaultChecked` turned `false` — would never be seen.
 */
function writeDefaults(input: HTMLInputElement, attributes: NodeAttributes, onServer: boolean): void {
  // A field with a `value` (`checked`) is the model's, and so is that attribute: a default written
  // beside it — even as `undefined`, passed straight through by a wrapper — does not touch it.
  if ("defaultValue" in attributes && attributes.value == null) {
    const value = attributes.defaultValue;
    if (value == null) input.removeAttribute("value");
    else if (input.getAttribute("value") !== String(value)) input.setAttribute("value", String(value));
  }
  if ("defaultChecked" in attributes && typeof attributes.checked !== "boolean") {
    const on = attributes.defaultChecked === true;
    if (input.hasAttribute("checked") === on) return;
    if (on && !onServer && input.type === "radio" && input.name !== "") keepThePick(input);
    input.toggleAttribute("checked", on);
  }
}

/**
 * A radio's default turned on takes its group's choice in a browser — when the attribute is written, or
 * when a new radio carrying it is put in the page. So the radio the user picked is noted BEFORE, while
 * the page still shows it, and checked again once the diff has put every radio where it goes and before
 * any `@mounted` runs: the new default changes only where a reset returns, as a `Select`'s does, and
 * whatever a `@mounted` then does to the radios stands.
 *
 * Only a pick in the radio's group once it is in place is put back — a commit that threw before its
 * mounts leaves this queued for the next, and a radio it never put in the page has no group to take —
 * and a radio a model holds only while the model still says it is on: what a model says is what its
 * radio shows.
 */
function keepThePick(input: HTMLInputElement): void {
  // A radio not yet in the page has no group to ask, so its picks are the document's of its name — one
  // put into a shadow root finds none of the picks there.
  const radios = input.isConnected ? groupOf(input) : Array.from(input.ownerDocument.getElementsByName(input.name));
  const picks = (radios as HTMLInputElement[]).filter(radioWasPicked);
  if (picks.length === 0) return;
  queueBeforeTheMounts(() => {
    // The default no longer holds the choice: a commit that threw before its mounts left this queued,
    // and the user has picked since. A pick since of the new default itself is not told apart.
    if (!input.checked) return;
    const group = groupOf(input);
    for (const pick of picks) {
      if (group.includes(pick) && (!heldByAModel(pick) || pick.hasAttribute("checked"))) pick.checked = true;
    }
  });
}

/**
 * Picked by the user (or a script), or held on by a model: on, with no `checked` attribute saying it
 * starts so — a model's radio carries the attribute as what it says. One that is on AND still the default
 * is not told apart from one never touched — the old default, picked again, when the new default comes
 * before it in the page.
 */
function radioWasPicked(radio: HTMLInputElement): boolean {
  return radio.checked && (heldByAModel(radio) || !radio.hasAttribute("checked"));
}

/**
 * Lets go of a ref the JSX has stopped giving this element.
 *
 * `ref` is not a DOM attribute, so it is never among the PREVIOUS attributes read
 * back off the node, and the attach loop only walks the keys present in the NEXT
 * ones. A disappearing `ref` was therefore invisible to both, and the element went
 * on holding the handle — a stale strong reference from the node to a ref nothing
 * points at, and a `current` still aimed at an element the JSX no longer connects
 * it to. A component's ref has behaved correctly since it was unified across
 * create, update and adopt; this is the same rule on the element side.
 *
 * AFTER the attach loop, so what is held is already this render's answer: equal
 * means the ref is still given and there is nothing to do. That ordering is also
 * what keeps the deliberate re-assertion intact — an element applies its ref on
 * every render, which is what makes two elements sharing one fall back to the
 * first when the second goes away.
 *
 * `current === node` for the same reason `releaseRef` checks it: another element
 * may have claimed the ref earlier in this same pass, and clearing then would wipe
 * a value that is now correct.
 */
function releaseDroppedRef(enhancedNode: EnhancedHTMLNode, nextRef: unknown): void {
  const held = enhancedNode[REF_SYM];
  if (held === undefined || held === nextRef) return;

  enhancedNode[REF_SYM] = undefined;
  if (held.current === enhancedNode) held.setCurrent(null);
}

/**
 * camelCase -> the dashed form CSS actually parses. Cached because this runs per
 * styled element per render, and the set of property names an app uses is tiny.
 *
 * Without it every camelCase declaration was **silently dropped** — the browser
 * parses `style.cssText` and discards declarations it cannot read, one by one,
 * with no error. `{ backgroundColor: "red", color: "blue" }` measured as
 * `style="color: blue;"`: half the style gone and nothing said so.
 */
const dashedNames = new Map<string, string>();

function toDashed(name: string): string {
  const cached = dashedNames.get(name);
  if (cached !== undefined) return cached;

  let dashed: string;
  if (name.startsWith("--")) {
    // A custom property is already in its final form and is case-sensitive.
    dashed = name;
  } else {
    dashed = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    // `WebkitTransform` -> `-webkit-transform`: the leading capital produced a
    // leading dash already, so nothing more to do. Kept explicit so the rule is
    // visible rather than an accident of the regex.
  }

  dashedNames.set(name, dashed);
  return dashed;
}

function objectStyleToString(styleObject: Record<string, string>): string {
  let styleString = "";
  for (const key in styleObject) {
    if (styleObject.hasOwnProperty(key)) {
      const value = styleObject[key];
      // A declaration with no value is not a declaration; emitting `key:;` would
      // make the browser drop it, and on some engines the whole rule with it.
      if (value === undefined || value === null || value === "") continue;
      styleString += `${toDashed(key)}: ${value}; `;
    }
  }

  return styleString.trim();
}

export function formatAttributes(attributes: NodeAttributes): Record<string, any> {
  // `class` was already normalized to `className` at vnode creation
  // (createRamonda), so this runs on style only.
  let result = attributes;

  const style = result.style;
  if (style && typeof style !== "string") {
    result = { ...result, style: objectStyleToString(style) };
  }

  return result;
}

/**
 * Writes `value`, and puts the caret back when doing so cannot have moved it anywhere sensible.
 *
 * Assigning `.value` makes the browser drop the selection to the END of the field. That is the
 * platform, not this framework, and for most writes it is invisible: a value only reaches here when
 * it DIFFERS from what the element holds, so a model that echoes back what the reader typed writes
 * nothing at all and the caret never moves.
 *
 * What is left is a controlled field whose model REWRITES the input — `toUpperCase()`, a mask, a
 * number formatter. There the reader types in the middle of the text and the caret jumps to the end,
 * so the next keystroke lands in the wrong place. Measured: `axbc` typed into, uppercased to `AXBC`,
 * caret at 4 rather than 2.
 *
 * **Only when the length is unchanged**, and the boundary is exact rather than cautious. A rewrite
 * that maps character to character leaves every offset meaning what it meant, so restoring the
 * number is restoring the position. A rewrite that inserts or removes characters does not: after
 * `1,234` becomes `12,345` the old offset points somewhere new, and putting the caret there would be
 * a guess dressed as a fix. Deciding THAT needs to know which characters are the separators, which
 * is the app's knowledge and not the framework's — an app that needs it reads the caret in
 * `@updated` and sets it where its own rules say.
 *
 * Guarded on the element supporting selection at all: `setSelectionRange` throws on an `<input>`
 * whose `type` is `number`, `email`, `date` or `color`, and a value written to one of those is a
 * value written to a field with no caret to keep.
 */
export function writeValue(enhancedNode: EnhancedHTMLNode, value: unknown, onServer: boolean): void {
  const field = enhancedNode as unknown as {
    value: unknown;
    selectionStart: number | null;
    setSelectionRange?: (start: number, end: number) => void;
  };

  /**
   * A server render has no caret to keep, and asking for one is not free: measured, twenty inputs
   * on a page cost twenty reads of `selectionStart` for an answer that can only be `null`. The
   * guard is the same one `runComponentEffects` and the commit queue already make.
   */
  if (onServer) {
    field.value = value;
    return;
  }

  const before = field.value;
  const caret = field.selectionStart;

  field.value = value;

  /**
   * Compared as the element will HOLD them, not as they were written.
   *
   * `<input value={this.count} />` hands over a number, and the DOM stringifies it on assignment —
   * so a rewrite of `1234` to `1235` is a rewrite of the same length, and the reader's caret is as
   * worth keeping there as in any other field. An earlier version of this line demanded strings on
   * both sides and quietly left every numeric model out: measured on the same edit, caret 3 with a
   * string model and 5 with a numeric one.
   */
  if (caret === null || before === null || before === undefined || value === null || value === undefined) return;
  if (String(before).length !== String(value).length) return;

  try {
    field.setSelectionRange?.(caret, caret);
  } catch {
    // A field whose `type` has no text selection. Nothing was lost: there was no caret to keep.
  }
}

/**
 * Attributes whose truth is a PROPERTY, so `false` has to be written rather than merely removed.
 *
 * Each of these keeps its state somewhere an attribute cannot reach once the element is live:
 * `checked` and `muted` because the attribute is the DEFAULT and stops driving the element the
 * moment a user touches it, `indeterminate` because it has no content attribute at all. Removing
 * the attribute on `false` therefore leaves the element saying the opposite of the model — a box
 * still ticked, a video still audible, a checkbox still mixed.
 */
const PROPERTY_TRUTH = new Set(["checked", "muted", "indeterminate"]);

function attachNextOnenhancedNode(
  enhancedNode: EnhancedHTMLNode,
  previousAttributes: NodeAttributes,
  nextAttributes: NodeAttributes,
  onServer: boolean,
) {
  for (const name in nextAttributes) {
    if (!nextAttributes.hasOwnProperty(name)) continue;
    const nextAttribute = nextAttributes[name];

    if (isInvisibleOnScreen(nextAttribute, name)) {
      /**
       * `checked={false}` is not "no attribute" — it is the model saying the box
       * is OFF, and removing the attribute cannot say that. Clicking a checkbox
       * sets its dirty-checkedness flag, after which the attribute no longer
       * drives `.checked` at all, so a box the user ticked stays ticked however
       * many times the model says otherwise. The property is the only thing left
       * that speaks.
       *
       * `false` specifically, not every invisible value: `checked={undefined}`
       * is a control the app is not driving, and forcing it off would take over
       * an uncontrolled box.
       *
       * The same for every name in `PROPERTY_TRUTH`, which is where the reason is
       * written out: each of them keeps its truth in a property that an attribute
       * cannot reach.
       */
      if (nextAttribute === false && PROPERTY_TRUTH.has(name) && name in enhancedNode) {
        (enhancedNode as unknown as Record<string, unknown>)[name] = false;
      }
      continue;
    }

    const previousAttribute = getPreviousFromenhancedNode(enhancedNode, name, previousAttributes[name]);

    if (!attributesEqual(nextAttribute, previousAttribute) || formPropertyDiverged(enhancedNode, name, nextAttribute)) {
      setNextOnenhancedNode(enhancedNode, name, nextAttribute, onServer);
    }
  }
}

/**
 * `value: any` and it stays. This function branches on what the attribute IS — a `ref` object, a
 * listener, a string, a boolean — and each branch hands the value to a DOM API with its own type.
 * Measured: `unknown` here is 11 narrowing casts, one per branch, which moves the looseness rather
 * than removing it. What would actually delete it is a discriminated value, which is a redesign of
 * how a vnode carries attributes.
 */
function setNextOnenhancedNode(enhancedNode: EnhancedHTMLNode, name: string, value: any, onServer: boolean) {
  // Here rather than at vnode creation, because this is where the value is FINAL — anything that
  // was going to normalise it already has.
  if (__DEV__) checkBooleanAttribute(enhancedNode.nodeName, name, value);

  /**
   * A boolean attribute carries no value, so `true` is written as the empty string.
   *
   * `disabled="true"` behaves correctly — a browser reads only whether the attribute is THERE — but
   * it is not what HTML says, and the word sits in every served page for nothing to read. It also
   * makes markup that does not round-trip: read the same element back through `outerHTML` in a
   * browser and it says `disabled=""`.
   *
   * Keyed on the NAME, not on the value being a boolean. `aria-hidden={true}` must stay
   * `aria-hidden="true"` — ARIA attributes are enumerated strings, and the empty one means neither
   * true nor false — and a `data-*` flag is data that something reads back.
   */
  if (value === true && isBooleanAttribute(name)) value = "";

  // Nor are an `<input>`'s defaults attributes of those names: `writeDefaults` writes them.
  if ((name === "defaultValue" || name === "defaultChecked") && enhancedNode.nodeName === "INPUT") return;

  if (name === "ref") {
    // Remembered on the node so unmount can clear it. Without that, `current`
    // kept pointing at a detached element: `if (ref.current) ref.current.focus()`
    // silently did nothing, and the whole subtree stayed reachable.
    const previous = enhancedNode[REF_SYM];
    if (previous && previous !== value) previous.setCurrent(null);
    enhancedNode[REF_SYM] = value ?? undefined;
    value?.setCurrent(enhancedNode);
    return;
  }

  /**
   * State this element keeps in a PROPERTY, with no attribute of that name to write it in.
   *
   * A checkbox's `indeterminate`, a media element's `volume`. Writing the attribute puts a word in
   * the document that nothing reads while the element goes on holding what it held before, so the
   * property is the whole answer and there is nothing to serialize.
   *
   * A table rather than a branch each, because the next one is a row. The list is in
   * `@ramonda/dom-facts`, with the rest of what this package and the checker agree about.
   *
   * The consequence, which is HTML's and not ours: none of this survives a server render. A checkbox
   * arrives unchecked rather than mixed and becomes mixed when hydration runs this line. There is
   * nowhere in markup to say it. `<select>` and `<textarea>` escape that only because their state
   * can be written as a CHILD — which is why each is a component rather than a row here.
   */
  if (keptInAProperty(enhancedNode.nodeName, name)) {
    if (name in enhancedNode) (enhancedNode as unknown as Record<string, unknown>)[name] = value;
    return;
  }

  if (name === "value") {
    // Both, because they say different things about the same element: the property is the value NOW,
    // and the attribute is the one it started with — which is also the only half a server render can
    // serialize. Not the property while an input method is composing in the field: writing it would
    // cancel the word, and the field shows the model once the word ends — see `composingIn`. Nor on an
    // `<input>` that already shows the model: a number field with `-` typed on the way to `-3` reports
    // `""`, the model holds `""`, and writing `""` back would take the `-` away — see `showsTheModel`.
    const input = enhancedNode.nodeName === "INPUT";
    const shown = input && showsTheModel(enhancedNode as unknown as HTMLInputElement, value);
    if (!shown && (!input || !composingIn(enhancedNode))) writeValue(enhancedNode, value, onServer);
    enhancedNode.setAttribute(name, value);
    return;
  }

  if (name === "checked" || name === "muted") {
    // The property as well as the attribute, for the dirty-checkedness reason
    // above: on a box the user has already clicked, the attribute is inert. The
    // attribute is still written so a server render and a hydrated page agree.
    //
    // `true` for any visible value: a boolean attribute is on when it is
    // PRESENT, so `checked=""` and even the mistaken `checked="false"` (RMD029)
    // mean a ticked box in HTML, and the property has to say the same thing or
    // the two disagree on the same element.
    //
    // `muted` is the same shape and was missing: the attribute went out and `.muted` stayed
    // `false`, so `<video muted>` played with sound — which is what an autoplaying video is not
    // allowed to do, and the browser blocks the play instead. On a media element the attribute is
    // the DEFAULT muted state, read when the element is parsed; the property is the state now.
    if (name in enhancedNode) (enhancedNode as unknown as Record<string, unknown>)[name] = true;
    enhancedNode.setAttribute(name, value);
    return;
  }

  if (name === "style") {
    enhancedNode.style.cssText = value;
    enhancedNode[STYLE_SYM] = value;
    return;
  }

  if (name === "className") {
    // On an SVG element `className` is a READ-ONLY SVGAnimatedString, so the
    // assignment below throws "which has only a getter" and takes the whole
    // render down. The attribute is `class` on both, and setting it works
    // everywhere — the property is only used on HTML because it is faster.
    if (enhancedNode[IS_SVG]) {
      enhancedNode.setAttribute("class", value);
    } else {
      enhancedNode.className = value;
    }
    return;
  }

  /**
   * The twin of `className`, and it was missing.
   *
   * `concepts/jsx` states the pair as one rule — "`class` and `for` are keywords in JavaScript, so
   * JSX borrows the DOM property names instead: `className` and `htmlFor`" — and only half of it
   * was implemented. Measured before this was written: `<label htmlFor="a">` rendered
   * `htmlfor="a"` and `label.htmlFor` read `""`, because an HTML attribute is written through
   * `setAttribute`, which lowercases the name and has no idea that `htmlfor` was meant to be `for`.
   * The label was associated with nothing, in markup that typechecks and looks right.
   *
   * Written as the ATTRIBUTE rather than through the property, unlike `className` above: `for` is
   * an attribute on `<label>` and `<output>` and nothing else, so the property does not exist to
   * assign on the element somebody may have written it on by mistake.
   */
  if (name === "htmlFor") {
    enhancedNode.setAttribute("for", value);
    return;
  }

  if (name === "key") {
    enhancedNode[KEY_SYM] = value;
    return;
  }

  /**
   * A listener is not an attribute, so `innerHTML` cannot serialize one — which is why attaching on
   * the server was harmless, and why it was left alone for a long time: skipping it looked like it
   * would cost the client a check to save work nobody sees.
   *
   * Measured, and it is worth it. 100 rows with four handlers each — 400 listeners — rendered in
   * 2.104 ms with them attached and 1.222 ms without: **42% of a listener-heavy server render**. The
   * cost on the client is one boolean already in hand, tested inside a branch that was about to make
   * two DOM calls anyway.
   */
  if (name.startsWith("on")) {
    if (onServer) return;

    const type = eventTypeOf(name);
    enhancedNode._listeners ??= {};
    const listeners = enhancedNode._listeners;

    /**
     * An `<input>`'s own handlers for the events its field answers are KEPT, not attached: its field
     * listener calls them, so it knows when they have returned — see `answerEdit`. Recorded among the
     * listeners all the same, so the next pass compares them as it does any.
     */
    if (enhancedNode.nodeName === "INPUT" && INPUT_OWN_EVENTS.has(type)) {
      listeners[name] = value;
      keepOwnHandler(enhancedNode as unknown as HTMLInputElement, name, type, value);
      return;
    }

    if (listeners[name]) {
      enhancedNode.removeEventListener(type, listeners[name]);
    }
    listeners[name] = value;
    enhancedNode.addEventListener(type, value);

    return;
  }

  if (enhancedNode[IS_SVG]) {
    enhancedNode.setAttributeNS(null, name, value);

    return;
  }

  enhancedNode.setAttribute(name, value);
}

/** The DOM's name for each attribute the JSX spells differently — read back the way it was written. */
const ALIASED_BACK: Readonly<Record<string, string>> = { class: "className", for: "htmlFor" };

function removeByQualifiedName(enhancedNode: EnhancedHTMLNode, name: string) {
  if (name === "key") {
    enhancedNode[KEY_SYM] = undefined;
    return;
  }
  if (name === "className") {
    // The DOM attribute is `class`; removing "className" would be a no-op.
    enhancedNode.removeAttribute("class");
    return;
  }
  if (name === "htmlFor") {
    // Same again: the DOM attribute is `for`.
    enhancedNode.removeAttribute("for");
    return;
  }
  if (enhancedNode[IS_SVG]) {
    enhancedNode.removeAttributeNS(null, name);
    return;
  }
  enhancedNode.removeAttribute(name);
}

function getPreviousFromenhancedNode(enhancedNode: EnhancedHTMLNode, name: string, value: any) {
  // NOT `style.cssText`: the browser normalizes what it stores, so comparing our
  // generated string against it never matched and the style was re-written on
  // every render. What we last wrote is the only thing worth comparing against.
  // `?? ""`: an element that never had a style must compare equal to an empty
  // one, or the first render writes `style=""` onto every host.
  if (name === "style") return enhancedNode[STYLE_SYM] ?? "";
  return value;
}

/**
 * Whether a form control is SHOWING something other than what the model says.
 *
 * `value` and `checked` are the two attributes that stop describing their
 * element the moment a user touches it: typing changes `input.value` and leaves
 * the attribute where it was, and clicking a checkbox changes `.checked` and
 * makes the attribute inert for good (the dirty-checkedness flag). So an
 * attribute-only diff compares the model against a stale record of itself,
 * agrees, and writes nothing — while the control keeps showing whatever the user
 * left there. The model silently stops being what is on screen.
 *
 * Asked IN ADDITION to the attribute comparison, never instead of it: the
 * attribute is what the element serializes, so it has to stay right for a server
 * render and for anything that reads the markup back.
 *
 * An untouched control's property already equals its attribute, so this answers
 * false for the ordinary case and nothing is written — which matters, because
 * writing `.value` sends the caret to the end and doing that on every unrelated
 * render would be its own bug.
 */
function formPropertyDiverged(enhancedNode: EnhancedHTMLNode, name: string, next: unknown): boolean {
  if (name !== "value" && name !== "checked") return false;
  if (!(name in enhancedNode)) return false;

  const live = (enhancedNode as unknown as Record<string, unknown>)[name];
  // A boolean attribute is on when it is PRESENT, so any visible value means a
  // ticked box — `checked=""` and the mistaken `checked="false"` (RMD029) both.
  if (name === "checked") return live !== true;
  // A number field's `1.50` already shows the model's 1.5 — see `showsTheModel`.
  if (enhancedNode.nodeName === "INPUT") return !showsTheModel(enhancedNode as unknown as HTMLInputElement, next);
  return !attributesEqual(next, live);
}

function getAllFromNode(enhancedNode: EnhancedHTMLNode): Record<string, any> {
  const nodeAttributes: Record<string, any> = {};

  /**
   * Handed back under the name the JSX WROTE, which is why `_listeners` is keyed by it.
   *
   * It used to hold the event TYPE and rebuild the name here, as `on` + the type with its first
   * letter capitalised. That matched while the types spelled events `on${Capitalize<name>}` and
   * stopped the moment they stopped: `click` came back as `onClick`, the next render's attributes
   * said `onclick`, the two never compared equal — so every listener on the page was removed and
   * re-attached on every render. Measured, two renders: `removes: click,my-event,click,my-event`.
   *
   * No rebuilding now, so nothing can be ambiguous either: `on:my-event` and `onmy-event` are two
   * different attributes that happen to name one event, and a reconstruction from the type could
   * only ever guess which was written.
   */
  if (enhancedNode._listeners) {
    Object.assign(nodeAttributes, enhancedNode._listeners);
  }

  const keyValue = enhancedNode[KEY_SYM];
  if (keyValue != null) nodeAttributes.key = keyValue;

  for (const item of enhancedNode.attributes) {
    // Read back under the name the JSX writes, so a diff compares like with like. Both aliases
    // normalize, because both are written in the source and both arrive here as the DOM's name.
    const name = ALIASED_BACK[item.name] ?? item.name;
    nodeAttributes[name] = item.value;
  }

  return nodeAttributes;
}

/**
 * The event type an `on…` attribute names.
 *
 * Two spellings, and the second exists because the first cannot express every event. `onclick` is
 * the DOM's own name with `on` in front, lowercased — which is exact, because every one of the 107
 * event types in the DOM's element maps is already all-lowercase, so lowercasing can never corrupt
 * one. Measured, all of them.
 *
 * `on:` hands the rest through UNTOUCHED, for a name the first form cannot reach: a custom event
 * with a dash or a capital in it. `<x-thing on:my-event={…} />` listens for `my-event`, because
 * `onmy-event` reads as a typo and `on-my-event` used to attach to `-my-event` — a listener for an
 * event nothing dispatches, which is the fault this closes.
 */
function eventTypeOf(name: string): string {
  return name.startsWith("on:") ? name.slice(3) : name.substring(2).toLowerCase();
}

function removePreviousFromenhancedNode(
  enhancedNode: EnhancedHTMLNode,
  previousAttributes: NodeAttributes,
  nextAttributes: NodeAttributes,
) {
  for (const name in previousAttributes) {
    const nextAttribute = nextAttributes[name];

    if (!isInvisibleOnScreen(nextAttribute, name)) continue;

    if (name.startsWith("on")) {
      const listeners = enhancedNode._listeners ?? {};
      const type = eventTypeOf(name);
      if (enhancedNode.nodeName === "INPUT" && INPUT_OWN_EVENTS.has(type)) {
        keepOwnHandler(enhancedNode as unknown as HTMLInputElement, name, type, undefined);
      } else {
        enhancedNode.removeEventListener(type, previousAttributes[name]);
      }
      delete listeners[name];
    } else if (!heldAsADefault(enhancedNode, name, nextAttributes)) {
      removeByQualifiedName(enhancedNode, name);
    }
  }
}

/**
 * An `<input>`'s `value` or `checked` attribute that its `defaultValue` or `defaultChecked` holds:
 * `writeDefaults` writes it, and only when the default changes. Taken away here and written back
 * there, a radio's `checked` would turn the default back on and the user's pick off, on every pass.
 *
 * An `<option>`'s `selected` is its `Select`'s, the same way — the types refuse it on the option, so
 * the render never says it. Taken away on hydration and written back by the select, it took the
 * option the reader picked before the script arrived.
 */
function heldAsADefault(enhancedNode: EnhancedHTMLNode, name: string, nextAttributes: NodeAttributes): boolean {
  if (enhancedNode.nodeName === "OPTION") return name === "selected";
  if (enhancedNode.nodeName !== "INPUT") return false;
  // Exactly when `writeDefaults` writes it: a default beside the model's `value` or `checked` is not.
  if (name === "value") return "defaultValue" in nextAttributes && nextAttributes.value == null;
  if (name === "checked") return "defaultChecked" in nextAttributes && typeof nextAttributes.checked !== "boolean";
  return false;
}

/**
 * Whether this render is saying the attribute should not be there at all.
 *
 * `false` normally means that, and has to: a boolean attribute is on whenever it is PRESENT, so
 * removing it is the only way to turn `disabled` off.
 *
 * An ARIA state is the exception, and the name is what tells them apart. `aria-expanded` is an
 * enumerated STRING with three answers — `"true"`, `"false"`, and absent for "this element has no
 * such state" — so removing it on `false` throws away the middle one and says something else
 * instead. A collapsed control read as having no expandable state at all.
 */
export function isInvisibleOnScreen(val: unknown, name: string): boolean {
  if (val === undefined || val === null) return true;
  if (val !== false) return false;
  return !name.startsWith("aria-");
}

/**
 * Lowercased first, because the DOM does it anyway.
 *
 * `setAttribute` lowercases the name it stores, so `readOnly={true}` becomes the attribute
 * `readonly` — and testing the JSX spelling against the list missed it, writing the very
 * `readonly="true"` this rule exists to stop. `checkBooleanAttribute` has always lowercased, so the
 * two disagreed about the same name: the diagnostic recognised it and the writer did not.
 *
 * The types reject the camelCase name outright — `RamondaArgs` keys on `Lowercase<string>`, so
 * `autoFocus` is not a property that exists — which leaves the ways a type cannot see: a spread whose
 * shape is loose, a JavaScript file, a base class widened by a cast. That is the reach a runtime rule
 * is for.
 */
function isBooleanAttribute(name: string): boolean {
  return BOOLEAN_ATTRIBUTES.has(name) || BOOLEAN_ATTRIBUTES.has(name.toLowerCase());
}

// DOM attribute values are always strings. When both sides are primitives we
// compare their string form so a numeric/boolean next value (e.g. 0, true) is
// not needlessly re-applied against its already-stored string ("0", "true").
// Objects/functions (ref, event handlers) are compared by identity.
function isPrimitive(val: unknown): boolean {
  return val === null || (typeof val !== "object" && typeof val !== "function");
}

function attributesEqual(next: unknown, previous: unknown): boolean {
  if (next === previous) return true;
  if (isPrimitive(next) && isPrimitive(previous)) {
    return String(next) === String(previous);
  }
  return false;
}
