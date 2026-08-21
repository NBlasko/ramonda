/**
 * A `ui` barrel that hands on everything core exports — as ordinary as a named re-export, and the
 * one shape the specifier chain cannot walk: a star export resolves straight to core's own
 * declaration, which names no module at all.
 */
export * from "@ramonda/core";
