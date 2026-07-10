import type { GameFile } from "@roomba/core";
import { SOURCES } from "./sources.js";

/** Search every source for a console's games and merge the results. */
export async function searchGames(
  alias: string,
  query: string,
): Promise<GameFile[]> {
  const perSource = await Promise.all(
    SOURCES.map((source) => source.search(alias, query)),
  );
  return perSource.flat();
}
