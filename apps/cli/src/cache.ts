import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Fetcher, HttpResponse } from "@roomba/core";

/** How long a cached response stays fresh: one day. */
const TTL_MS = 24 * 60 * 60 * 1000;

const CACHE_DIR = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "roomba");

interface CacheEntry {
  storedAt: number;
  response: HttpResponse;
}

/** Wrap a Fetcher with a filesystem cache. Only successful responses are stored. */
export function createCachingFetcher(base: Fetcher): Fetcher {
  return async (url, headers) => {
    const file = cacheFile(url);

    const cached = await readEntry(file);
    if (cached) return cached.response;

    const response = await base(url, headers);
    if (response.ok) {
      await writeEntry(file, { storedAt: Date.now(), response });
    }
    return response;
  };
}

/** Remove all cached responses. */
export async function cleanCache(): Promise<void> {
  await rm(CACHE_DIR, { recursive: true, force: true });
}

function cacheFile(url: URL): string {
  const hash = createHash("sha256").update(url.href).digest("hex");
  return join(CACHE_DIR, `${hash}.json`);
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

async function writeEntry(file: string, entry: CacheEntry): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(entry));
  } catch {
    // A cache write failure must never break the command.
  }
}
