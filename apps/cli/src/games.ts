import type { GameFile, RoomSource } from "@roomba/core";

export interface SearchFilters {
  /** Case-insensitive region substring, e.g. "usa". */
  region?: string;
  /** Case-insensitive language code, e.g. "en". */
  language?: string;
}

/**
 * Search every source for a console's games and merge the results. The console
 * alias is matched case-insensitively against each source's console list, and
 * region/language filters are applied on our side over the full result set (so
 * new sources only need to implement listing + search).
 */
export async function searchGames(
  sources: RoomSource[],
  alias: string,
  query: string,
  filters: SearchFilters = {},
): Promise<GameFile[]> {
  const wanted = alias.toLowerCase();
  let recognized = false;

  const perSource = await Promise.all(
    sources.map(async (source) => {
      const consoles = await source.loadConsoles();
      const match = consoles.find((console) => console.alias.toLowerCase() === wanted);
      if (!match) return [];
      recognized = true;
      return source.search(match.alias, query);
    }),
  );

  if (!recognized) {
    throw new Error(
      `Unknown console "${alias}". Run \`roomba consoles\` to see valid aliases.`,
    );
  }

  return perSource.flat().filter((game) => matchesFilters(game, filters));
}

function matchesFilters(game: GameFile, filters: SearchFilters): boolean {
  if (filters.region && !game.region.toLowerCase().includes(filters.region.toLowerCase())) {
    return false;
  }
  if (filters.language) {
    const codes = game.languages.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (!codes.includes(filters.language.toLowerCase())) return false;
  }
  return true;
}
