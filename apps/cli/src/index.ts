#!/usr/bin/env node
import { Command } from "commander";
import { searchGames } from "./games.js";
import { collectConsoles } from "./sources.js";
import { renderTable } from "./table.js";

const program = new Command();
program.name("roomba").description("Retro ROM vault aggregator");

program
  .command("consoles")
  .description("List every console available across all sources")
  .action(async () => {
    const rows = await collectConsoles();
    const table = renderTable(
      ["Console", "Alias", "Sources"],
      rows.map((row) => [row.name, row.alias, row.sources.join(", ")]),
    );
    console.log(table);
  });

program
  .command("console")
  .argument("<alias>", "console alias, e.g. PS1 (see `roomba consoles`)")
  .argument("<action>", "action to perform: search")
  .argument("<query...>", "game name to search for")
  .description("Operate on a specific console: roomba console <alias> search <name>")
  .action(async (alias: string, action: string, queryParts: string[]) => {
    if (action !== "search") {
      program.error(`Unknown action "${action}" for console. Supported: search`);
    }

    const query = queryParts.join(" ");
    const rows = await searchGames(alias, query);

    if (rows.length === 0) {
      console.log(`No games found for "${query}" on ${alias}.`);
      return;
    }

    const table = renderTable(
      ["Game", "Region", "Version", "Languages", "Rating", "Download URL"],
      rows.map((row) => [
        row.name,
        row.region,
        row.version,
        row.languages,
        row.rating,
        row.downloadUrl,
      ]),
    );
    console.log(table);
  });

try {
  await program.parseAsync();
} catch (error) {
  console.error(`roomba: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
