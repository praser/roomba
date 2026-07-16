#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { cleanCache } from "./cache.js";
import { downloadFile } from "./download.js";
import {
  defaultDownload,
  defaultEnginesDir,
  installEngine,
  readRegistry,
  removeEngine,
} from "./engines.js";
import { searchGames } from "./games.js";
import { updateCli, type Updater } from "./self-update.js";
import { collectConsoles, createSources } from "./sources.js";
import { renderTable } from "./table.js";
import { cliPackage, collectVersions, formatVersions } from "./version.js";

// `roomba --version` / `-v` prints CLI, core, and installed-engine versions.
// Handled up front (rather than via commander's plain version string) so it
// can read the registry, but only when it's the first argument — so it never
// shadows a subcommand's own flags.
const firstArg = process.argv[2];
if (firstArg === "-v" || firstArg === "--version") {
  console.log(formatVersions(await collectVersions()));
  process.exit(0);
}

const program = new Command();
program.name("roomba").description("Retro ROM vault aggregator");

/** Run a command, capturing stdout. Rejects on non-zero exit. */
function runCapture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited with code ${code}`)),
    );
  });
}

/** Run a command inheriting stdio (so npm's output streams through). */
function runInherit(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`)),
    );
  });
}

/** Update the CLI via npm's global install. */
const npmUpdater: Updater = {
  latest: (pkg) => runCapture("npm", ["view", pkg, "version"]),
  install: (spec) => runInherit("npm", ["install", "-g", spec]),
};

function printNoEngines(): void {
  console.log("No engines installed. Install one with:\n  roomba engine install <url>");
}

async function confirmInstall(url: string, yes: boolean): Promise<boolean> {
  console.warn(`⚠  Installs and runs untrusted code from:\n   ${url}`);
  if (yes) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Continue? [y/N] ");
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

program
  .command("consoles")
  .description("List every console available across all sources")
  .option("--no-cache", "bypass the HTTP cache and fetch fresh")
  .action(async (options: { cache: boolean }) => {
    const sources = await createSources({ cache: options.cache });
    if (sources.length === 0) return printNoEngines();
    const rows = await collectConsoles(sources);
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
  .option("--no-cache", "bypass the HTTP cache and fetch fresh")
  .action(
    async (
      alias: string,
      queryParts: string[],
      options: { region?: string; cache: boolean },
    ) => {
      const query = queryParts.join(" ");
      const sources = await createSources({ cache: options.cache });
      if (sources.length === 0) return printNoEngines();
      const rows = await searchGames(sources, alias, query, { region: options.region });

      if (rows.length === 0) {
        console.log(`No games found for "${query}" on ${alias}.`);
        return;
      }

      const table = renderTable(
        ["Title", "Region", "Version", "Size", "Source", "URL"],
        rows.map((row) => [
          row.name,
          row.region,
          row.version,
          row.size,
          row.source,
          row.downloadUrl,
        ]),
      );
      console.log(table);
    },
  );

program
  .command("download")
  .argument("<url>", "download URL from `roomba search`")
  .option("-o, --output <path>", "output file or directory (default: your Downloads folder)")
  .description("Download a game file")
  .action(async (url: string, options: { output?: string }) => {
    const sources = await createSources({ cache: false });
    if (sources.length === 0) return printNoEngines();
    await downloadFile(sources, url, { output: options.output });
  });

program
  .command("clean-cache")
  .description("Delete all cached HTTP responses")
  .action(async () => {
    await cleanCache();
    console.log("Cache cleared.");
  });

const engine = program.command("engine").description("Manage roomba engines");

engine
  .command("install")
  .argument("<url>", "URL of an engine bundle (a single JS file)")
  .option("-y, --yes", "skip the confirmation prompt")
  .description("Download and install an engine from a URL")
  .action(async (url: string, options: { yes?: boolean }) => {
    const entry = await installEngine(url, {
      dir: defaultEnginesDir(),
      download: (u) => defaultDownload(u),
      confirm: () => confirmInstall(url, options.yes ?? false),
    });
    if (!entry) {
      console.log("Installation cancelled.");
      return;
    }
    console.log(`Installed '${entry.id}' (${entry.name} ${entry.version}).`);
  });

engine
  .command("list")
  .description("List installed engines")
  .action(async () => {
    const entries = await readRegistry(defaultEnginesDir());
    if (entries.length === 0) {
      console.log("No engines installed.");
      return;
    }
    const table = renderTable(
      ["Id", "Name", "Version", "Source"],
      entries.map((e) => [e.id, e.name, e.version, e.sourceUrl]),
    );
    console.log(table);
  });

engine
  .command("remove")
  .argument("<id>", "engine id (see `roomba engine list`)")
  .description("Remove an installed engine")
  .action(async (id: string) => {
    await removeEngine(defaultEnginesDir(), id);
    console.log(`Removed '${id}'.`);
  });

program
  .command("update")
  .description("Update roomba to the latest published version (via npm)")
  .action(async () => {
    const { name, version } = cliPackage();
    await updateCli(name, version, npmUpdater);
  });

try {
  await program.parseAsync();
} catch (error) {
  console.error(`roomba: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
