import type { GameFile, RoomSource } from "@praser/roomba-core";

export interface SearchFilters {
  /** Case-insensitive region substring, e.g. "usa". */
  region?: string;
}

/** A search hit annotated with the id of the engine that produced it. */
export interface SearchResult extends GameFile {
  source: string;
}

/**
 * Search every source for a console's games and merge the results, tagging each
 * row with its source. The console alias is matched case-insensitively against
 * each source's console list, and the region filter is applied on our side over
 * the full result set (so new sources only need to implement listing + search).
 */
export async function searchGames(
  sources: RoomSource[],
  alias: string,
  query: string,
  filters: SearchFilters = {},
): Promise<SearchResult[]> {
  const wanted = alias.toLowerCase();
  let recognized = false;

  const perSource = await Promise.all(
    sources.map(async (source) => {
      const consoles = await source.loadConsoles();
      const match = consoles.find((console) => console.alias.toLowerCase() === wanted);
      if (!match) return [];
      recognized = true;
      const games = await source.search(match.alias, query);
      return games.map<SearchResult>((game) => ({ ...game, source: source.id }));
    }),
  );

  if (!recognized) {
    throw new Error(
      `Unknown console "${alias}". Run \`roomba consoles\` to see valid aliases.`,
    );
  }

  return perSource
    .flat()
    .filter((game) => matchesFilters(game, filters))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function matchesFilters(game: GameFile, filters: SearchFilters): boolean {
  if (filters.region && !game.region.toLowerCase().includes(filters.region.toLowerCase())) {
    return false;
  }
  return true;
}
