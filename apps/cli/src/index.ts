#!/usr/bin/env node
import { Command, Option } from "commander";
import { downloadFile } from "./download.js";
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
  .command("search")
  .argument("<alias>", "console alias, e.g. PS1 (case-insensitive; see `roomba consoles`)")
  .argument("<query...>", "game name to search for")
  .description("Search a console's games across all sources, one row per file")
  .option("-r, --region <region>", "filter by region (case-insensitive)")
  .option("-l, --lang <language>", "filter by language code (case-insensitive)")
  .addOption(new Option("--language <language>", "alias for --lang").hideHelp())
  .action(
    async (
      alias: string,
      queryParts: string[],
      options: { region?: string; lang?: string; language?: string },
    ) => {
      const query = queryParts.join(" ");
      const rows = await searchGames(alias, query, {
        region: options.region,
        language: options.lang ?? options.language,
      });

      if (rows.length === 0) {
        console.log(`No games found for "${query}" on ${alias}.`);
        return;
      }

      const table = renderTable(
        ["Game", "Region", "Version", "Languages", "Rating", "Size", "Download URL"],
        rows.map((row) => [
          row.name,
          row.region,
          row.version,
          row.languages,
          row.rating,
          row.size,
          row.downloadUrl,
        ]),
      );
      console.log(table);
    },
  );

program
  .command("download")
  .argument("<url>", "download URL from `roomba search`")
  .option(
    "-o, --output <path>",
    "output file or directory (default: your Downloads folder)",
  )
  .description("Download a game file")
  .action(async (url: string, options: { output?: string }) => {
    await downloadFile(url, options.output);
  });

try {
  await program.parseAsync();
} catch (error) {
  console.error(`roomba: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
