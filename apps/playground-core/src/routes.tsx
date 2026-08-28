import { createRoutes, createRouter } from "@ramonda/router";
import { HomePage } from "./pages/HomePage";
import { ShowcasePage } from "./pages/ShowcasePage";
import { TablePage } from "./pages/TablePage";
import { SlotsPage } from "./pages/SlotsPage";
import { CaretPage } from "./pages/CaretPage";
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
  "/table": <TablePage />,
  "/slots": <SlotsPage />,
  "/caret": <CaretPage />,
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
 * The kit, minted once and imported from here across the app.
 *
 * `Link` and `Navigator` are reachable only this way — `@ramonda/router` exports neither, so there
 * is no second, unchecked import to reach for by accident.
 */
export const { Link, Navigator, route } = createRouter(routes);
