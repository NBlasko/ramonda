import { createContext } from "../framework";

export const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });
