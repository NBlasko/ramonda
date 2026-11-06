/**
 * The colour words a tokens-only project still writes as they are: none is a colour anybody picked
 * off a palette. `currentcolor` refers to the inherited colour and `transparent` to no colour at all;
 * a project that takes colours only from its tokens is not asking for `$color.clear`. Found by an
 * agent building an app from the docs alone, under the template's strict config.
 *
 * Read by the TYPE a block is checked against, by what the editor OFFERS and by the rule that reads
 * composite properties — one list, so the three cannot disagree. A file of its own and importing
 * nothing: `codegen` and the rules import each other, and a constant in either was read before it
 * was set when bundled. `currentColor` is here as well
 * because CSS keywords ignore case and that is how the spec and most people spell it; the type is
 * the one reader that compares the text exactly.
 */
export const COLOUR_REFERENCES: readonly string[] = ["currentcolor", "currentColor", "transparent"];
