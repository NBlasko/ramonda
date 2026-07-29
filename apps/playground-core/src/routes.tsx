import { createRoutes } from "@ramonda/router";
import { HomePage } from "./pages/HomePage";
import { ShowcasePage } from "./pages/ShowcasePage";
import { TablePage } from "./pages/TablePage";
import { SlotsPage } from "./pages/SlotsPage";
import { AsyncPage } from "./pages/AsyncPage";
import { QueryPage } from "./pages/QueryPage";
import { UserPage } from "./pages/UserPage";
import { AboutPage } from "./pages/AboutPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { NotFoundPage } from "./pages/NotFoundPage";

// Compiled ONCE (stable identity → <Router> shallow-props skip; regexes prebuilt).
export const routes = createRoutes({
  "/": <HomePage />,
  "/showcase": <ShowcasePage />,
  "/table": <TablePage />,
  "/slots": <SlotsPage />,
  "/async": <AsyncPage />,
  "/query": <QueryPage />,
  "/users/:id": <UserPage />,
  "/about": <AboutPage />,
  "/diagnostics": <DiagnosticsPage />,
  "*": <NotFoundPage />,
});
