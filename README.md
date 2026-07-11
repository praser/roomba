# roomba

A command-line tool for browsing and downloading retro game ROMs from online
vaults. roomba aggregates one or more **sources** behind a single interface, so
you can list consoles, search a console's games (one row per downloadable file),
and download files — all from your terminal.

The first (and currently only) source is [Vimm's Lair](https://vimm.net).

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

See [`apps/cli/README.md`](apps/cli/README.md) for the full reference (flags,
filters, cache behavior, and examples).

## Repository layout

This is a [pnpm workspace](https://pnpm.io/workspaces) monorepo.

| Package | Path | Description |
|---|---|---|
| [`@roomba/core`](packages/core/README.md) | `packages/core` | Shared domain types and the `RoomSource` contract |
| [`@roomba/vimm`](packages/vimm/README.md) | `packages/vimm` | Vimm's Lair source, implements `RoomSource` |
| [`@roomba/cli`](apps/cli/README.md) | `apps/cli` | The `roomba` command-line app |

## Architecture

roomba keeps a clean separation so new providers are cheap to add:

- **`@roomba/core`** owns the vocabulary — `Console`, `GameFile`, and the
  `RoomSource` interface that every provider implements. No I/O, no scraping.
- **A source** (e.g. `@roomba/vimm`) implements `RoomSource`: list consoles,
  search, resolve a console alias, and describe how to download its URLs. HTTP
  access is done through an injected `Fetcher`, so caching is transparent.
- **`@roomba/cli`** wires sources together and does the cross-cutting work *on
  our side*: alias normalization (case-insensitive), region/language filtering,
  caching, and rendering.

A guiding principle: **sources return the full list; roomba filters and
normalizes at display time.** That keeps each provider small — a new source
only needs to fetch and parse, not implement filtering or caching.

### Adding a source

1. Create a package that exports a class implementing `RoomSource` from
   `@roomba/core` (see `@roomba/vimm` for a reference).
2. Register it in `apps/cli/src/sources.ts` (`createSources`).

That's it — search filtering, alias case-insensitivity, caching, and the
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
