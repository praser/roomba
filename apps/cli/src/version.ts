import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultEnginesDir, readRegistry } from "./engines.js";

export interface VersionInfo {
  /** This CLI's version (@praser/roomba). */
  cli: string;
  /** The installed @praser/roomba-core version, or "unknown" if unresolved. */
  core: string;
  /** Each installed engine's id and version. */
  engines: { id: string; version: string }[];
}

function readVersion(pkgJsonPath: string): string {
  return (JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { version: string }).version;
}

/** The CLI's own package.json name + version (read relative to the built entry). */
export function cliPackage(): { name: string; version: string } {
  const here = dirname(fileURLToPath(import.meta.url)); // <pkg>/dist
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
    name: string;
    version: string;
  };
  return { name: pkg.name, version: pkg.version };
}

/** Gather CLI, core, and installed-engine versions for `roomba --version`. */
export async function collectVersions(): Promise<VersionInfo> {
  const require = createRequire(import.meta.url);

  let core = "unknown";
  try {
    // Resolve core's main entry (always allowed), then read the package.json
    // beside it — this works regardless of the package's "exports" map.
    const coreEntry = require.resolve("@praser/roomba-core");
    core = readVersion(join(dirname(coreEntry), "..", "package.json"));
  } catch {
    // leave "unknown"
  }

  const engines = (await readRegistry(defaultEnginesDir())).map((e) => ({
    id: e.id,
    version: e.version,
  }));

  return { cli: cliPackage().version, core, engines };
}

/** Render version info as the multi-line block printed by `roomba --version`. */
export function formatVersions(info: VersionInfo): string {
  const lines = [`@praser/roomba ${info.cli}`, `@praser/roomba-core ${info.core}`];
  if (info.engines.length === 0) {
    lines.push("engines: (none installed)");
  } else {
    lines.push("engines:");
    for (const engine of info.engines) lines.push(`  ${engine.id} ${engine.version}`);
  }
  return lines.join("\n");
}
