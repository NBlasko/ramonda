/**
 * The autofill vocabulary, from the HTML specification's own list of autofill field names.
 *
 * A browser matches an `autocomplete` value against this set and nothing else. A token that is not
 * in it is not a near miss the browser corrects — the whole value is ignored and autofill does
 * nothing at all, silently.
 */
export const AUTOFILL_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "honorific-prefix",
  "given-name",
  "additional-name",
  "family-name",
  "honorific-suffix",
  "nickname",
  "username",
  "new-password",
  "current-password",
  "one-time-code",
  "organization-title",
  "organization",
  "street-address",
  "address-line1",
  "address-line2",
  "address-line3",
  "address-level4",
  "address-level3",
  "address-level2",
  "address-level1",
  "country",
  "country-name",
  "postal-code",
  "cc-name",
  "cc-given-name",
  "cc-additional-name",
  "cc-family-name",
  "cc-number",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
  "cc-csc",
  "cc-type",
  "transaction-currency",
  "transaction-amount",
  "language",
  "bday",
  "bday-day",
  "bday-month",
  "bday-year",
  "sex",
  "url",
  "photo",
  "tel",
  "tel-country-code",
  "tel-national",
  "tel-area-code",
  "tel-local",
  "tel-local-prefix",
  "tel-local-suffix",
  "tel-extension",
  "email",
  "impp",
]);

/**
 * The words that may sit BEFORE the field name, and say which of several addresses or numbers.
 *
 * `shipping`/`billing` group an address; the five contact ones group a telephone number or an
 * email. They are not field names on their own — `autocomplete="billing"` fills nothing.
 */
export const AUTOFILL_MODIFIERS: ReadonlySet<string> = new Set([
  "shipping",
  "billing",
  "home",
  "work",
  "mobile",
  "fax",
  "pager",
]);

/** `autocomplete="on"` and `="off"`, which are the whole value or nothing. */
export const AUTOFILL_SWITCHES: ReadonlySet<string> = new Set(["on", "off"]);

/**
 * The token the browser actually reads a value as, or `undefined` when nothing recognises it.
 *
 * The specification's grammar is: an optional `section-*`, an optional group word, an optional
 * contact word, the FIELD NAME, and an optional trailing `webauthn`. This reads the part of it
 * that is unambiguous — **the field name has to be there** — and does not police the order of what
 * sits in front of it. Getting the ordering rules exactly right is a second question, and being
 * wrong about it would mean reporting a value that fills perfectly well.
 */
export function autofillFieldOf(written: string): { field?: string; token: string } | undefined {
  const tokens = written.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return undefined;

  // `on` and `off` are the whole value. Anything beside one is not a valid pair, and saying which
  // half is wrong is a question this does not need to answer to report the value.
  if (tokens.length === 1 && AUTOFILL_SWITCHES.has(tokens[0] ?? ""))
    return { field: tokens[0], token: tokens[0] ?? "" };

  // A trailing `webauthn` is allowed after the field name and is not one itself.
  const last = tokens.at(-1) === "webauthn" ? tokens.at(-2) : tokens.at(-1);
  if (last === undefined) return undefined;
  if (AUTOFILL_FIELDS.has(last)) return { field: last, token: last };
  return { token: last };
}
