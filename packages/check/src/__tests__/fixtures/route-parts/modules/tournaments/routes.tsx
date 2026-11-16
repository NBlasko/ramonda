import { createRoutes } from "@ramonda/core";
import { TournamentList, TournamentPage } from "./pages";

export const tournamentRoutes = createRoutes({
  "/tournaments": <TournamentList />,
  "/tournaments/:id": <TournamentPage />,
});
