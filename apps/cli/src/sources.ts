import type { RoomSource } from "@roomba/core";
import { VimmRoomSource } from "@roomba/vimm";

/** All data sources roomba aggregates over. */
export const SOURCES: RoomSource[] = [new VimmRoomSource()];

export interface ConsoleRow {
  name: string;
  alias: string;
  sources: string[];
}

/** Load consoles from every source and merge them by alias. */
export async function collectConsoles(
  sources: RoomSource[] = SOURCES,
): Promise<ConsoleRow[]> {
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
