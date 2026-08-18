import { createContext } from "@ramonda/core";

/**
 * Declared in ANOTHER module and imported, which is the ordinary arrangement and the one the rule
 * has to work through: it resolves each name to the `BindingElement` it came from, so the two halves
 * are known to be one context without the rule ever reading a type or comparing a spelling.
 */
export const [ThemeProvider, ThemeConsumer] = createContext({ color: "slate" }, { label: "Theme" });

/** A second context, to prove the rule pairs by DECLARATION rather than by shape. */
export const [SizeProvider, SizeConsumer] = createContext({ size: "m" }, { label: "Size" });
