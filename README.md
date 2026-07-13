# roomba

A command-line tool for browsing and downloading retro game ROMs from online
vaults. roomba aggregates one or more **sources** behind a single interface, so
you can list consoles, search a console's games (one row per downloadable file),
and download files — all from your terminal.

roomba ships with no sources — you install **engines** (e.g.
[roomba-engine-vimm](https://github.com/), which scrapes
[Vimm's Lair](https://vimm.net)) with `roomba engine install <url>`.

```
$ roomba search PS1 "resident evil 2"
Game                              | Region  | Version | Languages | Rating | Size   | Download URL
Resident Evil 2 (Europe) (Disc 1) | Europe  | 1.0     | -         | 9.6    | 330 MB | https://dl3.vimm.net/?mediaId=44190
Resident Evil 2 (Europe) (Disc 2) | Europe  | 1.0     | -         | 9.6    | 332 MB | https://dl3.vimm.net/?mediaId=44545
...

$ roomba download "https://dl3.vimm.net/?mediaId=44190"
```

## Requirements

- **Node.js ≥ 22**
- **pnpm** (the repo pins a version via `packageManager`)

## Install & build

```bash
pnpm install
pnpm build
```

Run the CLI through the workspace script:

```bash
pnpm roomba consoles
pnpm roomba search snes "final fantasy" --region usa
```

Or invoke the built entry directly: `node apps/cli/dist/index.js <command>`.

## Commands

| Command | Description |
|---|---|
| `roomba consoles` | List every console across all sources |
| `roomba search <alias> <query>` | Search a console's games, one row per file |
| `roomba download <url> [-o <path>]` | Download a game file |
| `roomba clean-cache` | Delete all cached HTTP responses |
| `roomba engine install <url>` | Download and install an engine from a URL |
| `roomba engine list` | List installed engines |
| `roomba engine remove <id>` | Remove an installed engine |

See [`apps/cli/README.md`](apps/cli/README.md) for the full reference (flags,
filters, cache behavior, and examples).

## Repository layout

This is a [pnpm workspace](https://pnpm.io/workspaces) monorepo, organized into
two tiers:

| Tier | Path | Members |
|---|---|---|
| **Packages** — shared libraries | `packages/*` | [`@roomba/core`](packages/core/README.md) |
| **Apps** — end-user programs | `apps/*` | [`@roomba/cli`](apps/cli/README.md) |

**Engines are distributed in their own repositories, not bundled into roomba
as batteries included.** Each engine is a self-contained implementation of the
`RoomSource` contract that depends only on `@roomba/core`, so it can be built,
tested, versioned, and published on its own. Users install whichever engines
they want at runtime with `roomba engine install <url>`; roomba loads them
from disk.

## Architecture

roomba keeps a clean separation so new engines are cheap to add:

- **`@roomba/core`** owns the vocabulary — `Console`, `GameFile`, and the
  `RoomSource` interface that every engine implements. No I/O, no scraping.
- **An engine** (e.g. [roomba-engine-vimm](https://github.com/)) implements
  `RoomSource`: list consoles, search, resolve a console alias, and describe
  how to download its URLs. HTTP access is done through an injected
  `Fetcher`, so caching is transparent, and the engine depends on nothing but
  `@roomba/core`.
- **`@roomba/cli`** wires engines together and does the cross-cutting work *on
  our side*: alias normalization (case-insensitive), region/language filtering,
  caching, and rendering.

A guiding principle: **engines return the full list; roomba filters and
normalizes at display time.** That keeps each engine small — a new one only
needs to fetch and parse, not implement filtering or caching.

### Writing an engine

1. Build a standalone package that bundles to a single ESM file exporting a
   `RoomEngine` (`id`, `name`, `version`, `apiVersion`, and a `create(ctx)`
   that returns a `RoomSource` implementing `@roomba/core`'s contract). See
   [roomba-engine-vimm](https://github.com/) for a reference implementation.
2. Publish the bundle somewhere reachable by URL.
3. Users run `roomba engine install <url>` to add it — no changes to roomba
   itself are needed.

Once installed, search filtering, alias case-insensitivity, caching, and the
download command all work automatically.

## Development

```bash
pnpm build        # build all packages (TypeScript project references)
pnpm test         # run the unit test suite (Vitest)
pnpm test:watch   # watch mode
```

The test suite runs entirely offline — sources are tested through a fake
`Fetcher`, so no network requests are made.

## Disclaimer

roomba is a client for publicly reachable web sources and is provided for
personal and educational use. Video games are copyrighted works; you are
responsible for complying with the laws of your jurisdiction and with the terms
of service of any source you access. Please be respectful of source websites
(the built-in HTTP cache exists partly to avoid hammering them). The authors do
not host, distribute, or endorse the downloading of any copyrighted material.

## License

[MIT](LICENSE) © Rubens Praser Junior
