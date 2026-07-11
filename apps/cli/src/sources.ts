import type { RoomSource } from "@roomba/core";
import { directFetcher, VimmRoomSource } from "@roomba/vimm";
import { createCachingFetcher } from "./cache.js";

/** Build the set of data sources roomba aggregates over. */
export function createSources(options: { cache: boolean }): RoomSource[] {
  const fetcher = options.cache ? createCachingFetcher(directFetcher) : directFetcher;
  return [new VimmRoomSource({ fetcher })];
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
