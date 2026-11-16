import { createRoutes } from "@ramonda/router";
import { HomePage } from "./pages/HomePage";
import { ShowcasePage } from "./pages/ShowcasePage";
import { CssPage } from "./pages/CssPage";
import { TablePage } from "./pages/TablePage";
import { SlotsPage } from "./pages/SlotsPage";
import { CaretPage } from "./pages/CaretPage";
import { FieldsPage } from "./pages/FieldsPage";
import { SelectCasesPage } from "./pages/SelectCasesPage";
import { ExitPage } from "./pages/ExitPage";
import { AsyncPage } from "./pages/AsyncPage";
import { QueryPage } from "./pages/QueryPage";
import { FormPage } from "./pages/FormPage";
import { UserPage } from "./pages/UserPage";
import { AboutPage } from "./pages/AboutPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { NotFoundPage } from "./pages/NotFoundPage";

// Compiled ONCE (stable identity → <Router> shallow-props skip; regexes prebuilt).
export const routes = createRoutes({
  "/": <HomePage />,
  "/showcase": <ShowcasePage />,
  "/css": <CssPage />,
  "/table": <TablePage />,
  "/slots": <SlotsPage />,
  "/caret": <CaretPage />,
  "/fields": <FieldsPage />,
  "/select-cases": <SelectCasesPage />,
  "/exit": <ExitPage />,
  "/async": <AsyncPage />,
  "/query": <QueryPage />,
  "/form": <FormPage />,
  "/users/:id": <UserPage />,
  "/about": <AboutPage />,
  "/diagnostics": <DiagnosticsPage />,
  "*": <NotFoundPage />,
});

/**
 * The table, registered: every `Link`, `Navigator` and `route()` in this program is checked against
 * it, and each is imported from `@ramonda/router` — never from here, so no page imports this module
 * back.
 */
declare module "@ramonda/router" {
  interface Routes {
    app: typeof routes;
  }
}
