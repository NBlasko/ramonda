import { createRoutes } from "@ramonda/core";
import { DebugPage } from "./pages";

export const debugRoutes = createRoutes({ "/debug": <DebugPage /> });
