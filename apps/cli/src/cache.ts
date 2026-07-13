import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Fetcher, HttpResponse } from "@praser/roomba-core";

/** How long a cached response stays fresh: one day. */
const TTL_MS = 24 * 60 * 60 * 1000;

/** Default on-disk cache location (honors XDG_CACHE_HOME). */
export function defaultCacheDir(): string {
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "roomba");
}

interface CacheEntry {
  storedAt: number;
  response: HttpResponse;
}

/** Wrap a Fetcher with a filesystem cache. Only successful responses are stored. */
export function createCachingFetcher(
  base: Fetcher,
  cacheDir: string = defaultCacheDir(),
): Fetcher {
  return async (url, headers) => {
    const file = cacheFile(cacheDir, url);

    const cached = await readEntry(file);
    if (cached) return cached.response;

    const response = await base(url, headers);
    if (response.ok) {
      await writeEntry(cacheDir, file, { storedAt: Date.now(), response });
    }
    return response;
  };
}

/** Remove all cached responses. */
export async function cleanCache(cacheDir: string = defaultCacheDir()): Promise<void> {
  await rm(cacheDir, { recursive: true, force: true });
}

function cacheFile(cacheDir: string, url: URL): string {
  const hash = createHash("sha256").update(url.href).digest("hex");
  return join(cacheDir, `${hash}.json`);
}

async function readEntry(file: string): Promise<CacheEntry | null> {
  try {
    const entry = JSON.parse(await readFile(file, "utf8")) as CacheEntry;
    if (Date.now() - entry.storedAt > TTL_MS) return null; // expired
    return entry;
  } catch {
    return null; // missing or corrupt
  }
}

async function writeEntry(
  cacheDir: string,
  file: string,
  entry: CacheEntry,
): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, JSON.stringify(entry));
  } catch {
    // A cache write failure must never break the command.
  }
}
