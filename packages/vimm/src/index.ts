import { URL } from "node:url";
import { parse } from "node-html-parser";
import type { Console, DownloadRequest, GameFile, RoomSource } from "@roomba/core";
import { parseSearchListings, parseVariations } from "./parse.js";

export const VIMM_BASE_URL = "https://vimm.net";

const USER_AGENT = "roomba (+https://vimm.net)";

// Vimm's download hosts reject non-browser User-Agents and require a matching
// Referer, so downloads need this browser-like UA rather than USER_AGENT.
const DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** How many release detail pages to fetch at once when searching. */
const SEARCH_CONCURRENCY = 8;

/**
 * Data source backed by Vimm's Lair (https://vimm.net).
 */
export class VimmRoomSource implements RoomSource {
  readonly id = "vimm";
  readonly baseURL;

  constructor(baseURL: string = VIMM_BASE_URL) {
    this.baseURL = new URL(baseURL);
  }

  /** Build the vault URL for a console alias (e.g. "PS2" -> https://vimm.net/vault/PS2). */
  resolve(alias: string): URL {
    return new URL(`/vault/${alias}`, this.baseURL);
  }

  downloadRequest(url: URL): DownloadRequest | null {
    if (url.hostname !== "vimm.net" && !url.hostname.endsWith(".vimm.net")) {
      return null;
    }
    return {
      url,
      headers: {
        "user-agent": DOWNLOAD_USER_AGENT,
        referer: `${this.baseURL.origin}/`,
      },
    };
  }

  async loadConsoles(): Promise<Console[]> {
    const vaultUrl = new URL("/vault", this.baseURL);
    const root = parse(await this.fetchText(vaultUrl));

    const subMenu = root.querySelector("#subMenu");
    if (!subMenu) {
      throw new Error(`Could not find #subMenu at ${vaultUrl.href}`);
    }

    return subMenu.querySelectorAll("a").flatMap((anchor) => {
      const href = anchor.getAttribute("href");
      const name = anchor.text.trim();
      if (!href || !name) return [];
      // On Vimm the vault slug (last path segment) is the console's alias.
      const alias = new URL(href, this.baseURL).pathname.split("/").filter(Boolean).pop();
      if (!alias) return [];
      return [{ name, alias }];
    });
  }

  async search(alias: string, query: string): Promise<GameFile[]> {
    const listUrl = new URL("/vault/", this.baseURL);
    listUrl.searchParams.set("p", "list");
    listUrl.searchParams.set("system", alias);
    listUrl.searchParams.set("q", query);

    // Vimm answers a search with no matches (or an unknown system) with a 404.
    const listHtml = await this.fetchText(listUrl, { allow404: true });
    if (listHtml === null) return [];

    const listings = parseSearchListings(listHtml);

    // Each listing's detail page holds the per-file variations; fetch them in
    // parallel and combine release metadata with each downloadable file. A
    // single failing detail page is skipped rather than failing the search.
    const perListing = await mapWithConcurrency(
      listings,
      SEARCH_CONCURRENCY,
      async (listing) => {
        const detailUrl = new URL(`/vault/${listing.id}`, this.baseURL);
        let variations;
        try {
          variations = parseVariations(await this.fetchText(detailUrl));
        } catch (error) {
          console.warn(`roomba: skipping ${detailUrl.href}: ${(error as Error).message}`);
          return [];
        }
        return variations.map<GameFile>((variation) => ({
          name: variation.name,
          region: listing.region,
          version: variation.version,
          languages: listing.languages,
          rating: listing.rating,
          downloadUrl: variation.downloadUrl,
        }));
      },
    );

    return perListing.flat();
  }

  private async fetchText(url: URL, options?: { allow404: false }): Promise<string>;
  private async fetchText(url: URL, options: { allow404: true }): Promise<string | null>;
  private async fetchText(url: URL, options?: { allow404: boolean }): Promise<string | null> {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    if (options?.allow404 && response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url.href}: ${response.status} ${response.statusText}`,
      );
    }
    return response.text();
  }
}

/** Map over items with a bounded number of concurrent workers, preserving order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
