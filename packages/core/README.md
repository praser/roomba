# @roomba/core

The shared vocabulary of [roomba](../../README.md): the domain types and the
`RoomSource` contract that every data source implements. This package contains
**no I/O and no scraping** — just types. That keeps sources and the CLI decoupled
and makes the whole system testable.

> Part of the [roomba](../../README.md) monorepo.

## Types

### `Console`

A game console offered by a source.

```ts
interface Console {
  name: string;   // "PlayStation 2"
  alias: string;  // "PS2" — stable, unique key used to address the console
}
```

### `GameFile`

A single downloadable file. One game release can expand into several of
these — one per disc, revision, and format variation.

```ts
interface GameFile {
  name: string;        // full title incl. region/disc/revision/format markers
  region: string;      // "USA, Canada"
  version: string;     // "1.0"
  languages: string;   // "en,fr,es"
  rating: string;      // "9.6"
  size: string;        // "330 MB"
  downloadUrl: string; // direct URL for this specific file
}
```

### `RoomSource`

The interface every source implements.

```ts
interface RoomSource {
  id: string;
  baseURL: URL;

  /** List every console this source offers. */
  loadConsoles(): Promise<Console[]>;

  /** Resolve a console alias to this source's URL for it. */
  resolve(alias: string): URL;

  /** Search a console (by alias) for games, one entry per file. */
  search(alias: string, query: string): Promise<GameFile[]>;

  /**
   * If this source recognizes the download URL, return the request (URL plus
   * any required headers) needed to fetch it; otherwise null.
   */
  downloadRequest(url: URL): DownloadRequest | null;
}
```

Design notes:

- **Sources return the full list.** Region/language filtering and
  case-insensitive alias matching are done by the CLI, not here — so a new
  source only implements fetch + parse.
- **`downloadRequest` describes, it doesn't fetch.** A source declares which
  URLs it owns and what headers they need (e.g. a `Referer`); the CLI performs
  the streaming download. This keeps large-file handling out of sources.

### `DownloadRequest`

```ts
interface DownloadRequest {
  url: URL;
  headers: Record<string, string>;
}
```

### `Fetcher` / `HttpResponse`

An injectable HTTP-GET abstraction. Sources fetch through a `Fetcher` so callers
can layer caching (or not) around it transparently — the source never knows
whether it is cached.

```ts
interface HttpResponse {
  status: number;
  ok: boolean;
  body: string;
}

type Fetcher = (url: URL, headers?: Record<string, string>) => Promise<HttpResponse>;
```

## License

[MIT](../../LICENSE)
