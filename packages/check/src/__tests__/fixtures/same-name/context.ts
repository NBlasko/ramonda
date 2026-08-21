import { createContext } from "@ramonda/core";

export const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });
