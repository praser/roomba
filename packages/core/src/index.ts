export const VERSION = "0.0.0";

export interface Console {
  /** Human-readable console name, e.g. "PlayStation 2". */
  name: string;
  /** Stable, unique identifier used to resolve a console to a source URL, e.g. "PS2". */
  alias: string;
}

/**
 * A single downloadable file. One game release can expand into several of
 * these — one per disc, revision, and format variation.
 */
export interface GameFile {
  /** Full descriptive title, including region/disc/revision/format markers. */
  name: string;
  /** Release region(s), e.g. "USA, Canada". */
  region: string;
  /** File version, e.g. "1.0". */
  version: string;
  /** Languages, e.g. "En,Fr,Es". */
  languages: string;
  /** Community rating, e.g. "9.6". */
  rating: string;
  /** Direct download URL for this specific file. */
  downloadUrl: string;
}

/** The HTTP request a source needs to fetch one of its download URLs. */
export interface DownloadRequest {
  url: URL;
  headers: Record<string, string>;
}

export interface RoomSource {
  id: string;
  baseURL: URL;
  /** List every console this source offers. */
  loadConsoles: () => Promise<Console[]>;
  /** Resolve a console alias to this source's URL for it. */
  resolve: (alias: string) => URL;
  /** Search a console (by alias) for games matching a query, one entry per file. */
  search: (alias: string, query: string) => Promise<GameFile[]>;
  /**
   * If this source recognizes the download URL, return the request (URL plus
   * any required headers) needed to fetch it; otherwise null.
   */
  downloadRequest: (url: URL) => DownloadRequest | null;
}