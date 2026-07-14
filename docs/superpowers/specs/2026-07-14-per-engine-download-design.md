# Per-engine download resolution

**Date:** 2026-07-14
**Status:** Approved (design)

## Problem

`roomba download <url>` does a single `fetch` of whatever `downloadRequest`
returns. That fits Vimm (a direct file link) but not Emuparadise, whose search
results point at a **game page**; the real file is reached by navigating:
game page → `…/<id>-download` → `#download-link`
(`/roms/get-download.php?gid=…&token=…`) → 301 to the file on a CDN. Each engine
should own however its download resolves.

## Approach (approved)

Keep `downloadRequest` but make it **awaitable**, so an engine may navigate
(using its injected `Fetcher`) before returning the final request. Backward
compatible — no `apiVersion` bump, no forced reinstall, Vimm unchanged.

### Contract (`@praser/roomba-core` 1.4.0, additive)

```ts
export type Awaitable<T> = T | Promise<T>;

interface RoomSource {
  // …
  downloadRequest(url: URL): Awaitable<DownloadRequest | null>;
}
```

A sync implementation (Vimm's) still satisfies the broadened type. The engine
resolves using `this.fetcher` (the string `Fetcher` from `create(ctx)`), which
is for HTML navigation only — the large file stream stays in the CLI.

### CLI (`apps/cli`)

- `download.ts`: `pickDownloadRequest` becomes async — `await
  source.downloadRequest(url)` per source, first non-null wins; then stream via
  raw `fetch` exactly as today (follows the 301 to the CDN, progress, filename,
  save).
- `games.ts`: sort merged search results by title (case-insensitive
  `localeCompare` on `name`).

### Engines

- **Vimm** — unchanged; sync `downloadRequest` returns the direct link + headers.
- **Emuparadise** — `async downloadRequest(gamePageUrl)`:
  1. return `null` for non-`emuparadise.me` hosts;
  2. fetch `` `${gamePageUrl}-download` `` via the injected fetcher;
  3. parse the `#download-link` `href`
     (`/roms/get-download.php?gid=…&token=…&mirror_available=true`), resolved
     against the base URL;
  4. return `{ url, headers: { browser UA, referer: the -download page } }`.
  Throw a clear error if the link isn't found. roomba streams it, following the
  301 to the file. (Verified the chain resolves statelessly.)

## Testing

- Emuparadise: unit-test `downloadRequest` with a fake `Fetcher` serving a
  `-download` fixture containing `#download-link`; assert the resolved URL +
  headers; `null` for foreign hosts; throws when the link is missing.
- CLI: `download.ts` awaits an async `downloadRequest` (fake source returning a
  Promise); existing download/table tests still pass; add a games sort test.

## Rollout

core 1.4.0 + cli via the roomba release pipeline; then rebuild/release the
Emuparadise engine (Vimm untouched); reinstall.
