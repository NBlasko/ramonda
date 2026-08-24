import { createContext } from "@ramonda/core";

export const [ThemeProvider, ThemeConsumer] = createContext({ color: "slate" }, { label: "Theme" });
export const [SizeProvider, SizeConsumer] = createContext({ size: "m" }, { label: "Size" });
