import { createContext } from "../../framework";

/** A context declared in one package and consumed in another, which is the ordinary case. */
export const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });
