# @roomba/cli

The `roomba` command-line app. It wires the available [engines](../../engines/vimm)
together and adds the cross-cutting behavior — case-insensitive alias matching,
region/language filtering, an on-disk HTTP cache, and table rendering.

> Part of the [roomba](../../README.md) monorepo.

## Usage

During development, run through the workspace script (from the repo root):

```bash
pnpm roomba <command> [...]
```

Or invoke the built binary directly: `node apps/cli/dist/index.js <command>`.
The package also declares a `roomba` bin, so it resolves as `roomba` wherever
the package is linked/installed.

## Commands

### `roomba consoles`

List every console available across all sources.

```
$ roomba consoles
Console       | Alias | Sources
Atari 2600    | Atari2600 | vimm
...
PlayStation   | PS1   | vimm
```

| Option | Description |
|---|---|
| `--no-cache` | Bypass the HTTP cache and fetch fresh |

### `roomba search <alias> <query>`

Search a console's games. Emits **one row per downloadable file**, so a
multi-disc game or a release available in several formats produces several rows.

The `<alias>` is case-insensitive (`SNES`, `snes`, `gamecube` all work). The
query may be quoted or passed as trailing words.

```
$ roomba search snes "final fantasy" --region usa
Game                       | Region | Version | Languages | Rating | Size   | Download URL
Final Fantasy II (USA).sfc | USA    | 1.0     | -         | 8.5    | 639 KB | https://dl3.vimm.net/?mediaId=34421
...
```

| Option | Description |
|---|---|
| `-r, --region <region>` | Filter by region, case-insensitive substring (e.g. `usa`, `europe`) |
| `-l, --lang <code>` | Filter by language code, case-insensitive (e.g. `en`, `es`). `--language` also works |
| `--no-cache` | Bypass the HTTP cache and fetch fresh |

Filtering happens on our side over the full result set. Note that some sources
don't tag a language for every release (e.g. many single-language cartridge
games), in which case `--lang` won't match them.

### `roomba download <url> [-o <path>]`

Download a game file from a URL produced by `roomba search`.

```bash
roomba download "https://dl3.vimm.net/?mediaId=44190"
roomba download "https://dl3.vimm.net/?mediaId=44190" -o ~/roms/
roomba download "https://dl3.vimm.net/?mediaId=44190" -o ~/roms/re2-disc1.7z
```

| Option | Description |
|---|---|
| `-o, --output <path>` | Output **file** (used as-is) or **directory** (server filename inside it). Defaults to your OS Downloads folder |

Behavior:

- The file streams to disk with a live progress indicator (handles multi-GB
  files without buffering in memory).
- The filename comes from the server's `Content-Disposition` (game name +
  correct extension) unless you give an explicit file path.
- With no `-o`, files go to `~/Downloads` (created if needed).
- Downloads are **not** cached.

### `roomba clean-cache`

Delete all cached HTTP responses.

## Cache

Search and console listings are cached to reduce repeated requests to sources:

- **Location:** `$XDG_CACHE_HOME/roomba` if set, otherwise `~/.cache/roomba`
- **Keyed by:** the request URL (SHA-256)
- **TTL:** 1 day; only successful (2xx) responses are stored
- **Bypass:** `--no-cache` on `search`/`consoles`
- **Clear:** `roomba clean-cache`

Downloads never use the cache.

## Layout

| File | Responsibility |
|---|---|
| `src/index.ts` | Commander program: command/flag definitions |
| `src/sources.ts` | `createSources({ cache })` + console aggregation |
| `src/games.ts` | Search across sources, alias normalization, filtering |
| `src/download.ts` | Streaming download, filename resolution, progress |
| `src/cache.ts` | Filesystem caching `Fetcher` wrapper |
| `src/table.ts` | Column-aligned table rendering |

## License

[MIT](../../LICENSE)
