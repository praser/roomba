#!/usr/bin/env node
import { Command, Option } from "commander";
import { cleanCache } from "./cache.js";
import { downloadFile } from "./download.js";
import { searchGames } from "./games.js";
import { collectConsoles, createSources } from "./sources.js";
import { renderTable } from "./table.js";

const program = new Command();
program.name("roomba").description("Retro ROM vault aggregator");

program
  .command("consoles")
  .description("List every console available across all sources")
  .option("--no-cache", "bypass the HTTP cache and fetch fresh")
  .action(async (options: { cache: boolean }) => {
    const rows = await collectConsoles(createSources({ cache: options.cache }));
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
  .option("--no-cache", "bypass the HTTP cache and fetch fresh")
  .action(
    async (
      alias: string,
      queryParts: string[],
      options: { region?: string; lang?: string; language?: string; cache: boolean },
    ) => {
      const query = queryParts.join(" ");
      const sources = createSources({ cache: options.cache });
      const rows = await searchGames(sources, alias, query, {
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
    await downloadFile(createSources({ cache: false }), url, options.output);
  });

program
  .command("clean-cache")
  .description("Delete all cached HTTP responses")
  .action(async () => {
    await cleanCache();
    console.log("Cache cleared.");
  });

try {
  await program.parseAsync();
} catch (error) {
  console.error(`roomba: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
