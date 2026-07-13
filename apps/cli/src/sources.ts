import type { Fetcher, HttpResponse, RoomSource } from "@praser/roomba-core";
import { createCachingFetcher } from "./cache.js";
import { defaultEnginesDir, loadEngines } from "./engines.js";

/** Default uncached Fetcher: a plain HTTP GET via global fetch. */
export const directFetcher: Fetcher = async (url, headers): Promise<HttpResponse> => {
  const response = await fetch(url, { headers });
  return { status: response.status, ok: response.ok, body: await response.text() };
};

/** Build the set of data sources from the user's installed engines. */
export async function createSources(options: { cache: boolean }): Promise<RoomSource[]> {
  const fetcher = options.cache ? createCachingFetcher(directFetcher) : directFetcher;
  return loadEngines(defaultEnginesDir(), { fetcher });
}

export interface ConsoleRow {
  name: string;
  alias: string;
  sources: string[];
}

/** Load consoles from every source and merge them by alias. */
export async function collectConsoles(sources: RoomSource[]): Promise<ConsoleRow[]> {
  const results = await Promise.all(
    sources.map(async (source) => ({
      id: source.id,
      consoles: await source.loadConsoles(),
    })),
  );

  const byAlias = new Map<string, ConsoleRow>();
  for (const { id, consoles } of results) {
    for (const console of consoles) {
      const row =
        byAlias.get(console.alias) ??
        { name: console.name, alias: console.alias, sources: [] };
      if (!row.sources.includes(id)) row.sources.push(id);
      byAlias.set(console.alias, row);
    }
  }
  return [...byAlias.values()].sort((a, b) => a.name.localeCompare(b.name));
}
