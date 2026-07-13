# External, installable engines for roomba

**Date:** 2026-07-13
**Status:** Approved (design)

## Problem

roomba currently bundles its only data source, the Vimm's Lair engine
(`engines/vimm`), directly into the monorepo. `apps/cli/src/sources.ts` imports
`@roomba/vimm` at compile time and hardcodes `new VimmRoomSource(...)`.

For legal reasons we do not want to distribute engines as part of roomba. The
engine must live in its own project, and roomba must gain a way to install
third-party engines at runtime so that anybody can write one. The headline
command is:

```
roomba engine install <url>
```

## Goals

- Remove all engines from roomba's distribution; roomba ships engine-free.
- Let anyone author an engine as a standalone project and publish a single
  bundled JS file at a URL.
- `roomba engine install <url>` downloads that bundle, validates it, and
  registers it so roomba discovers and uses it at runtime.
- Provide `list` and `remove` alongside `install`.
- Keep the existing `RoomSource` aggregation model unchanged — engines still
  implement `RoomSource`.
- Follow semver for the change.

## Non-goals

- Publishing `@roomba/core` to npm in this change (we make it publishable; the
  actual `npm publish` is left to the maintainer, who has npm auth).
- An engine registry/marketplace, auto-update, or version pinning beyond
  "reinstall the same id to overwrite".
- Sandboxing the executed engine code (we warn + confirm instead; see Security).

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Install transport | **Raw source download** — `<url>` is a single self-contained bundled JS file. No npm, no git. |
| Vimm extraction | Scaffold standalone `roomba-engine-vimm`, use its built bundle to test the install flow end-to-end, then delete `engines/vimm` from the roomba workspace. |
| Default engines | None. roomba ships empty; commands print a helpful "no engines installed" message. |
| `@roomba/core` | Made publishable (drop `private`), not published in this change. Engine authors depend on it dev-only for types. |
| Install safety | Warn + `y/N` confirm, skippable with `--yes`. |
| Version bump | roomba root + `@roomba/cli`: 1.0.0 → 2.0.0. `@roomba/core`: 1.0.0 → 1.1.0. `roomba-engine-vimm`: 1.0.0. |

## Architecture

Convert the CLI's compile-time engine import into runtime plugin discovery.
Three moving parts:

1. **`@roomba/core`** grows a published engine contract (`RoomEngine` +
   `ENGINE_API_VERSION`) alongside the existing `RoomSource`.
2. **`apps/cli`** gains an engine manager (install / list / remove) and a
   loader that reads installed bundles at runtime and instantiates their
   `RoomSource`s.
3. **`engines/vimm`** is extracted into a standalone project
   (`roomba-engine-vimm`) that bundles itself to a single JS file, then removed
   from the roomba workspace.

## The contract (`@roomba/core`)

Additive to the current `packages/core/src/index.ts`:

```ts
/**
 * The engine contract major version roomba speaks. Bump when RoomSource or
 * RoomEngine change incompatibly; roomba refuses to load an engine whose
 * apiVersion differs from this.
 */
export const ENGINE_API_VERSION = 1;

/** What roomba injects into an engine when constructing its RoomSource. */
export interface EngineContext {
  /** HTTP fetcher roomba provides (may be caching). Engines should use this
   *  rather than calling fetch directly, so caching/offline behavior works. */
  fetcher: Fetcher;
}

/** The value an engine bundle must default-export. */
export interface RoomEngine {
  /** Stable, unique id, e.g. "vimm". Also the on-disk filename + registry key. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** ENGINE_API_VERSION the engine was built against. */
  apiVersion: number;
  /** Engine's own semver, shown in `engine list`. */
  version: string;
  /** Construct the RoomSource. */
  create(ctx: EngineContext): RoomSource;
}
```

- An engine bundle's **default export** is a `RoomEngine`.
- roomba refuses to load an engine whose `apiVersion` ≠ `ENGINE_API_VERSION`.
  That mismatch is the semver gate for the plugin API.
- Types are compile-time only, so an engine that dev-depends on `@roomba/core`
  bundles to nothing at runtime.

## On-disk layout & registry

State lives under `enginesDir()`, matching the existing XDG convention used by
`cache.ts` (which honors `XDG_CACHE_HOME`):

```
enginesDir() = (XDG_DATA_HOME ?? ~/.local/share) + /roomba/engines
```

```
engines/
  registry.json        # source of truth for what is installed
  vimm.js              # the downloaded bundle, named <id>.js
```

`registry.json` shape:

```jsonc
[
  {
    "id": "vimm",
    "name": "Vimm's Lair",
    "version": "1.0.0",
    "apiVersion": 1,
    "sourceUrl": "https://.../vimm.js",
    "installedAt": "2026-07-13T00:00:00.000Z"
  }
]
```

## CLI: `roomba engine` command

A parent `engine` command with three subcommands.

### `install <url> [--yes]`

1. Print a warning naming the source URL and that installing runs untrusted
   code; require `y/N` confirmation. `--yes` skips the prompt (for CI/scripting).
2. Fetch the bundle over HTTP.
3. Write it to a temp file inside `enginesDir()`.
4. Dynamic-`import()` the temp file; read its default export.
5. Validate: default export is an object with string `id`/`name`/`version`,
   numeric `apiVersion`, and a `create` function; and `apiVersion` equals
   `ENGINE_API_VERSION`. On failure, delete the temp file and error out.
6. Move the temp file to `<id>.js` and upsert the `registry.json` entry.
   Reinstalling the same id overwrites its bundle and entry (acts as update).
7. Print a confirmation (`Installed '<id>' (<name> <version>).`).

### `list`

Render a table of installed engines: id, name, version, source URL. Empty
message when none installed.

### `remove <id>`

Delete `<id>.js` and its registry entry. Error if the id is not installed.

## Loader + empty state

`apps/cli/src/sources.ts`'s `createSources()` becomes **async**:

1. Read `registry.json` (missing/corrupt → treat as empty).
2. For each entry, dynamic-`import()` the bundle, validate the default export
   and `apiVersion`, and call `engine.create({ fetcher })`.
3. A broken or incompatible engine is **skipped with a warning**, never fatal.
4. Return `RoomSource[]`.

The caching fetcher wiring stays in the CLI exactly as today (engines receive
it via `EngineContext.fetcher`).

When zero engines load, `consoles` / `search` / `download` print:

```
No engines installed. Install one with:
  roomba engine install <url>
```

`createSources` is only ever called inside async command actions, so making it
async requires no signature changes to `searchGames` / `downloadFile`, which
continue to take `RoomSource[]`.

## Extracted Vimm engine (`roomba-engine-vimm`)

A standalone project (destined for its own git repo):

- Own `package.json`, version `1.0.0`, not part of the roomba workspace.
- `@roomba/core` as a **dev-only** dependency (types only).
- `node-html-parser` as a real dependency, inlined by the bundler.
- `esbuild` bundles `src/` into a single ESM file `dist/vimm.js`
  (`--bundle --format=esm --platform=node`).
- `src/index.ts` default-exports a `RoomEngine`:
  ```ts
  const engine: RoomEngine = {
    id: "vimm",
    name: "Vimm's Lair",
    apiVersion: ENGINE_API_VERSION,
    version: "1.0.0",
    create: (ctx) => new VimmRoomSource({ fetcher: ctx.fetcher }),
  };
  export default engine;
  ```
- The existing `VimmRoomSource`, `parse.ts`, and their tests move here verbatim.

We build `dist/vimm.js` and install it into roomba via a `file://` URL to test
the real end-to-end flow, then delete `engines/vimm` and its
`pnpm-workspace.yaml` entry from roomba.

## Testing

- **core**: a type-level test that a sample `RoomEngine` conforms; `create`
  returns a `RoomSource`.
- **cli — engine manager**: install writes `<id>.js` + registry entry; reinstall
  overwrites; `remove` deletes both; `list` reflects the registry. Use a fixture
  bundle written into a temp `enginesDir()`, mirroring the temp-dir pattern in
  `cache.test.ts`.
- **cli — loader**: loads a valid fixture engine; skips a bundle with a
  mismatched `apiVersion` (with warning, not throw); returns empty when the
  registry is missing; empty-state message renders.
- **vimm engine**: existing `parse`/`vimm` tests come along; add a test that the
  built (or source) module default-exports a valid `RoomEngine`.

## Security

Installing runs untrusted third-party code (the bundle is imported, and its
`create` executes). We mitigate with a clear warning + `y/N` confirmation on
`install`, skippable via `--yes`. Full sandboxing is out of scope.

## Versioning (semver)

| Package | From | To | Reason |
|---|---|---|---|
| roomba (root) | 1.0.0 | 2.0.0 | Breaking: no built-in source out of the box |
| `@roomba/cli` | 1.0.0 | 2.0.0 | Same |
| `@roomba/core` | 1.0.0 | 1.1.0 | Additive: new `RoomEngine`/`EngineContext`/`ENGINE_API_VERSION` exports; made publishable |
| `roomba-engine-vimm` | — | 1.0.0 | New standalone project, `apiVersion: 1` |

`ENGINE_API_VERSION` starts at `1` and is bumped independently whenever the
`RoomSource`/`RoomEngine` contract changes incompatibly.
