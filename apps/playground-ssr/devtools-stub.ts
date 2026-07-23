/**
 * Core dynamically imports the devtools in DEV. There is no panel on a server,
 * and `__DEV__` stays true here on purpose — diagnostics are the reason this
 * playground exists — so the import is pointed at nothing instead.
 */
export {};
