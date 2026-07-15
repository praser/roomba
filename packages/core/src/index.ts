export const VERSION = "0.0.0";

/** Hardware category from the Batocera systems page. */
export type ConsoleCategory =
  | "arcade"
  | "home-console"
  | "portable"
  | "home-computer"
  | "port"; // Port, Flatpak & Miscellaneous

export interface Console {
  /** Canonical display name, e.g. "Super Nintendo Entertainment System". */
  name: string;
  /** Batocera system / ROM-folder name, e.g. "snes". THE placement target. */
  alias: string;
  /** Hardware category from the Batocera systems page. */
  category: ConsoleCategory;
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
  /**
   * Compressed file size. Engines should pass their raw size string through
   * `normalizeSize` so every source renders consistently (e.g. "330 MB").
   */
  size: string;
  /** Optional languages, e.g. "En,Fr,Es". Not displayed by roomba. */
  languages?: string;
  /** Optional community rating, e.g. "9.6". Not displayed by roomba. */
  rating?: string;
  /** Direct download URL for this specific file. */
  downloadUrl: string;
}

/** The HTTP request a source needs to fetch one of its download URLs. */
export interface DownloadRequest {
  url: URL;
  headers: Record<string, string>;
}

/** Result of an HTTP GET performed by a Fetcher. */
export interface HttpResponse {
  status: number;
  ok: boolean;
  body: string;
}

/**
 * Performs an HTTP GET for a URL with optional headers, returning the body.
 * Injected into sources so callers can layer caching (or not) around it.
 */
export type Fetcher = (
  url: URL,
  headers?: Record<string, string>,
) => Promise<HttpResponse>;

/** A value that may be returned directly or as a promise. */
export type Awaitable<T> = T | Promise<T>;

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
   * If this source recognizes the download URL, return the request (final URL
   * plus any required headers) needed to fetch it; otherwise null.
   *
   * May be async: an engine can navigate intermediate pages (using its injected
   * Fetcher) to resolve the real file link before returning. roomba streams the
   * returned URL, following redirects.
   */
  downloadRequest: (url: URL) => Awaitable<DownloadRequest | null>;
  /**
   * If this source recognizes the URL, return the catalog alias of the console
   * it belongs to (e.g. "snes"); otherwise null. May be async: an engine can
   * navigate intermediate pages (via its injected Fetcher) to determine it.
   */
  consoleFor: (url: URL) => Awaitable<string | null>;
}

/**
 * The engine contract major version roomba speaks. Bump when RoomSource or
 * RoomEngine change incompatibly; roomba refuses to load an engine whose
 * apiVersion differs from this.
 */
export const ENGINE_API_VERSION = 2;

/** What roomba injects into an engine when constructing its RoomSource. */
export interface EngineContext {
  /**
   * HTTP fetcher roomba provides (may be caching). Engines should use this
   * rather than calling fetch directly, so caching/offline behavior works.
   */
  fetcher: Fetcher;
}

/** The value an engine bundle must default-export. */
export interface RoomEngine {
  /** Stable, unique id, e.g. "vimm". Also the on-disk filename + registry key. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** The ENGINE_API_VERSION the engine was built against. */
  apiVersion: number;
  /** The engine's own semver, shown in `roomba engine list`. */
  version: string;
  /** Construct the RoomSource. */
  create(ctx: EngineContext): RoomSource;
}

export { CONSOLES, CONSOLE_BY_ALIAS } from "./consoles.js";
export { SYSTEM_EXTENSIONS, acceptedExtensions } from "./extensions.js";
export { normalizeSize } from "./size.js";
