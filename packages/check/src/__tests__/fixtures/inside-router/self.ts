import { Hook } from "@ramonda/core";

/**
 * The router, imported by its own package name.
 *
 * That is what makes this fixture the case `exempt` exists for: a package whose `package.json` says
 * `@ramonda/router` AND which reaches for itself by name, so `needs` is satisfied inside the very
 * package the rule is about.
 */
export declare class Router extends Hook {}
