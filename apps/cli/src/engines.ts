import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ENGINE_API_VERSION,
  type EngineContext,
  type RoomEngine,
  type RoomSource,
} from "@roomba/core";

/** On-disk location for installed engines (honors XDG_DATA_HOME). */
export function defaultEnginesDir(): string {
  return join(
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
    "roomba",
    "engines",
  );
}

export interface RegistryEntry {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  sourceUrl: string;
  installedAt: string;
}

function registryFile(dir: string): string {
  return join(dir, "registry.json");
}

function bundleFile(dir: string, id: string): string {
  return join(dir, `${id}.mjs`);
}

/** Read the installed-engine registry. Missing or corrupt → empty list. */
export async function readRegistry(dir: string): Promise<RegistryEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(registryFile(dir), "utf8"));
    return Array.isArray(parsed) ? (parsed as RegistryEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeRegistry(dir: string, entries: RegistryEntry[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(registryFile(dir), JSON.stringify(entries, null, 2));
}

/**
 * Validate that a dynamically imported module's default export is a RoomEngine
 * built against the contract version we support. Throws with a clear message
 * otherwise.
 */
export function validateEngine(mod: unknown): RoomEngine {
  const engine = (mod as { default?: unknown }).default;
  if (!engine || typeof engine !== "object") {
    throw new Error("engine module has no default export");
  }
  const e = engine as Record<string, unknown>;
  if (
    typeof e.id !== "string" ||
    typeof e.name !== "string" ||
    typeof e.version !== "string" ||
    typeof e.apiVersion !== "number" ||
    typeof e.create !== "function"
  ) {
    throw new Error("default export is not a valid RoomEngine");
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(e.id)) {
    throw new Error(`engine id "${e.id}" is not a valid identifier`);
  }
  if (e.apiVersion !== ENGINE_API_VERSION) {
    throw new Error(
      `engine targets API version ${e.apiVersion}, but roomba speaks ${ENGINE_API_VERSION}`,
    );
  }
  return engine as RoomEngine;
}

/** Import an engine bundle from a local file and return its validated RoomEngine. */
export async function importEngine(bundlePath: string): Promise<RoomEngine> {
  const mod = await import(pathToFileURL(bundlePath).href);
  return validateEngine(mod);
}

/**
 * Default `download` for `installEngine`: fetches http(s) URLs, reads
 * `file:` URLs and local filesystem paths, and rejects other URL schemes.
 */
export async function defaultDownload(url: string): Promise<string> {
  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
    return res.text();
  }
  if (url.startsWith("file:")) {
    return readFile(fileURLToPath(url), "utf8");
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    throw new Error(`Unsupported URL scheme for engine install: ${url}`);
  }
  return readFile(url, "utf8");
}

export interface InstallOptions {
  dir: string;
  /** Fetch the bundle source for a URL. Injected for testability. */
  download: (url: string) => Promise<string>;
  /** Ask the user to confirm. Injected for testability. Return true to proceed. */
  confirm: () => Promise<boolean>;
}

/**
 * Download, validate, and register an engine from a URL. Returns the registry
 * entry, or null if the user declined confirmation.
 */
export async function installEngine(
  url: string,
  options: InstallOptions,
): Promise<RegistryEntry | null> {
  if (!(await options.confirm())) return null;

  await mkdir(options.dir, { recursive: true });
  const source = await options.download(url);

  // Write to a temp file first so a bad bundle never lands under <id>.mjs.
  const tmpDir = await mkdtemp(join(options.dir, ".install-"));
  try {
    const tmpFile = join(tmpDir, "engine.mjs");
    await writeFile(tmpFile, source);

    const engine = await importEngine(tmpFile);
    await rename(tmpFile, bundleFile(options.dir, engine.id));

    const entry: RegistryEntry = {
      id: engine.id,
      name: engine.name,
      version: engine.version,
      apiVersion: engine.apiVersion,
      sourceUrl: url,
      installedAt: new Date().toISOString(),
    };
    const others = (await readRegistry(options.dir)).filter((e) => e.id !== engine.id);
    await writeRegistry(options.dir, [...others, entry]);
    return entry;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/** Remove an installed engine by id. Throws if it is not installed. */
export async function removeEngine(dir: string, id: string): Promise<void> {
  const entries = await readRegistry(dir);
  if (!entries.some((e) => e.id === id)) {
    throw new Error(`No engine named "${id}" is installed.`);
  }
  await rm(bundleFile(dir, id), { force: true });
  await writeRegistry(
    dir,
    entries.filter((e) => e.id !== id),
  );
}

/**
 * Load every installed engine and construct its RoomSource with the given
 * context. A broken or incompatible engine is skipped with a warning.
 */
export async function loadEngines(
  dir: string,
  ctx: EngineContext,
): Promise<RoomSource[]> {
  const sources: RoomSource[] = [];
  for (const entry of await readRegistry(dir)) {
    try {
      const engine = await importEngine(bundleFile(dir, entry.id));
      sources.push(engine.create(ctx));
    } catch (error) {
      console.warn(
        `roomba: skipping engine "${entry.id}": ${(error as Error).message}`,
      );
    }
  }
  return sources;
}
