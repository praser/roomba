import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetcher, HttpResponse } from "@praser/roomba-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanCache, createCachingFetcher } from "../src/cache.js";

const ok = (body: string): HttpResponse => ({ status: 200, ok: true, body });

let cacheDir: string;
let calls: number;
let base: Fetcher;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "roomba-cache-"));
  calls = 0;
});

afterEach(async () => {
  await cleanCache(cacheDir);
});

function countingBase(response: HttpResponse): Fetcher {
  return async () => {
    calls++;
    return response;
  };
}

describe("createCachingFetcher", () => {
  it("fetches once then serves subsequent calls from cache", async () => {
    base = countingBase(ok("<html>hi</html>"));
    const fetcher = createCachingFetcher(base, cacheDir);
    const url = new URL("https://vimm.net/vault");

    const first = await fetcher(url);
    const second = await fetcher(url);

    expect(first.body).toBe("<html>hi</html>");
    expect(second.body).toBe("<html>hi</html>");
    expect(calls).toBe(1);
  });

  it("does not cache non-2xx responses", async () => {
    base = countingBase({ status: 404, ok: false, body: "" });
    const fetcher = createCachingFetcher(base, cacheDir);
    const url = new URL("https://vimm.net/vault/?q=nope");

    await fetcher(url);
    await fetcher(url);

    expect(calls).toBe(2);
  });

  it("re-fetches once an entry is older than the TTL", async () => {
    base = countingBase(ok("fresh"));
    const fetcher = createCachingFetcher(base, cacheDir);
    const url = new URL("https://vimm.net/vault");

    await fetcher(url);
    await expireCacheEntries(cacheDir);
    await fetcher(url);

    expect(calls).toBe(2);
  });

  it("cleanCache removes stored entries", async () => {
    base = countingBase(ok("x"));
    const fetcher = createCachingFetcher(base, cacheDir);
    const url = new URL("https://vimm.net/vault");

    await fetcher(url);
    await cleanCache(cacheDir);
    await fetcher(url);

    expect(calls).toBe(2);
  });
});

/** Rewrite every cache entry's storedAt to two days ago. */
async function expireCacheEntries(dir: string): Promise<void> {
  const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
  for (const name of await readdir(dir)) {
    const file = join(dir, name);
    const entry = JSON.parse(await readFile(file, "utf8"));
    entry.storedAt = twoDaysAgo;
    await writeFile(file, JSON.stringify(entry));
  }
}
