#!/usr/bin/env node
import { Command } from "commander";
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

await program.parseAsync();
