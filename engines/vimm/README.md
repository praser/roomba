# @roomba/vimm

A [roomba](../../README.md) data source backed by [Vimm's Lair](https://vimm.net).
Implements the [`RoomSource`](../../packages/core/README.md) contract by scraping the public
site.

> Part of the [roomba](../../README.md) monorepo.

## Usage

```ts
import { VimmRoomSource } from "@roomba/vimm";

const vimm = new VimmRoomSource();

await vimm.loadConsoles();        // -> Console[]
await vimm.search("PS1", "resident evil 2"); // -> GameFile[] (one per file)
vimm.resolve("PS2");              // -> URL https://vimm.net/vault/PS2
vimm.downloadRequest(url);        // -> { url, headers } | null
```

### Options

```ts
new VimmRoomSource({
  baseURL: "https://vimm.net", // override the base (e.g. for tests)
  fetcher: myFetcher,          // inject an HTTP Fetcher (default: direct fetch)
});
```

The exported `directFetcher` is the default uncached `Fetcher` (a plain
`fetch`). Wrap it to add behavior — roomba's CLI wraps it with a filesystem
cache.

## How it works

Vimm doesn't offer an API, so this source parses HTML:

- **`loadConsoles`** reads the console links from the vault sub-menu
  (`#subMenu`). Each console's **alias is its vault slug** — e.g. `/vault/PS1`
  → `PS1` — which is also what `resolve` and search use.
- **`search`** requests the list page
  (`/vault/?p=list&system=<alias>&q=<query>`), then fetches each result's detail
  page (bounded concurrency) to read its files.
- Each detail page embeds a `let media=[...]` JSON array (discs/revisions) plus
  an optional `dl_format` `<select>` (formats). The source expands these into
  one `GameFile` per actual file, decoding the base64 `GoodTitle`, gating
  formats by non-zero size, and combining them with the release's
  region/languages/rating from the list page.
- A no-result search returns HTTP 404, which is treated as an empty result.

## Download URLs

`search` emits Vimm's own download endpoint, e.g.
`https://dl3.vimm.net/?mediaId=44190` (with `&alt=N` for alternate formats). Two
important details, both handled by `downloadRequest`:

- The download host varies (`dl2`/`dl3`…) and is read from each detail page.
- Vimm's download hosts require a `Referer: https://vimm.net/` **and** a
  browser-like `User-Agent`; requests without them are rejected with `400`.

(The public `archival.cat` mirror was evaluated and is unreliable — it times
out — so it is not used.)

## Layout

| File | Responsibility |
|---|---|
| `src/index.ts` | `VimmRoomSource` class + `directFetcher` |
| `src/parse.ts` | Pure HTML parsers: `parseSearchListings`, `parseVariations` |

The parsers are pure functions over HTML strings, which makes them (and the
source, via an injected `Fetcher`) fully unit-testable without network access.

## License

[MIT](../../LICENSE)
