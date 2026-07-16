# Post-download hook + remove Batocera auto-placement

**Date:** 2026-07-15
**Status:** Approved (design)

## Goal

Replace roomba's built-in, per-system post-download behavior with a single,
generic **user hook**, and remove the Batocera console auto-recognition and
ROM-folder placement entirely. roomba goes back to being a plain downloader:
it saves the file (Downloads by default, or `--output`) and, if the user has
placed a `roomba.post-download.sh` in the destination folder, runs it.

```
$ roomba download "<url>"
→ saves to ~/Downloads/Some Game.zip
→ if ~/Downloads/roomba.post-download.sh exists, run it (cwd = ~/Downloads,
  $1 = "Some Game.zip", $ROOMBA_FILE = /abs/.../Some Game.zip)
```

This supersedes the archive-extraction feature (spec
`2026-07-15-post-download-archive-extraction-design.md`) and walks back the
placement half of the Batocera integration (`2026-07-14-batocera-integration-design.md`):
system-specific work (extract, build launcher files, convert to chd, refresh
EmulationStation) now lives in the user's own script, which scales to every
system without roomba carrying the logic.

## Why

A hardcoded per-system catalog (accepted-extensions, launcher-file rules, …)
is heavy to maintain and can never cover every case. A hook inverts it: roomba
stays dumb and stable; the user expresses their environment's needs in shell.
One mechanism serves Batocera, a plain Linux box, a NAS, anything.

## Decisions (from brainstorming)

1. **Hook contract:** invoke `sh <hookpath>` (no `chmod` needed) with the
   downloaded file's **basename as `$1`**, **CWD = the destination folder**, and
   env `ROOMBA_FILE` (absolute path), `ROOMBA_FILENAME` (basename), `ROOMBA_URL`.
2. **Hook failure:** best-effort — a non-zero exit or a missing `sh` warns to
   stderr; roomba still exits 0 (the download already succeeded). Never throws.
3. **`consoleFor`:** removed from the `RoomSource` contract; `ENGINE_API_VERSION`
   bumps 2 → 3.
4. **Versioning (semver, breaking):** `@praser/roomba` 2.0.2 → 3.0.0;
   `@praser/roomba-core` 2.0.0 → 3.0.0; root private `package.json` → 3.0.0.

## Scope

**In:**
- New `roomba.post-download.sh` hook, run after a completed download.
- Remove Batocera detection, console auto-recognition, ROM-folder placement,
  library refresh, the `roomba_console` URL param, and the archive-extraction
  feature added earlier on this branch.
- Remove `-c, --console` and `--no-refresh` download flags.
- Remove `consoleFor` from `RoomSource`; bump `ENGINE_API_VERSION`.
- Version bumps and doc updates.

**Out (non-goals):**
- Pre-download or other hook points (only post-download for now).
- Passing structured metadata to the hook beyond the three env vars + `$1`.
- Any per-system knowledge in roomba.
- Windows/`.cmd` hooks — the hook is `sh`-invoked (Batocera/Linux target).

**Kept unchanged:** `roomba consoles`, `roomba search`, the `CONSOLES` catalog
(browsing/search, unrelated to placement), caching, resumable downloads,
engine install/list/remove, self-update.

## Architecture

### New — `apps/cli/src/hooks.ts`

```ts
export interface HookDeps {
  run?: (
    cmd: string,
    args: string[],
    opts: { cwd: string; env: NodeJS.ProcessEnv },
  ) => Promise<{ code: number }>;
  exists?: (p: string) => boolean;
}

/** Fixed hook filename roomba looks for in the destination folder. */
export const POST_DOWNLOAD_HOOK = "roomba.post-download.sh";

/**
 * Run the post-download hook if `<dir>/roomba.post-download.sh` exists.
 * Invokes `sh <hookpath> <basename>` with cwd=dir and ROOMBA_* env. Best-effort:
 * a non-zero exit or missing `sh` warns to stderr and resolves; never throws.
 * No-op (and no warning) when the hook file is absent.
 */
export async function runPostDownloadHook(
  dir: string,
  filePath: string,
  url: string,
  deps?: HookDeps,
): Promise<void>;
```

Default `run` spawns `sh` with `stdio: "inherit"` (the script's output streams
to the user), resolving `{ code }` on close and `{ code: -1 }` on the spawn
`error` event. Default `exists` is `existsSync`. Env passed to the child is
`{ ...process.env, ROOMBA_FILE, ROOMBA_FILENAME, ROOMBA_URL }`.

### Changed — `apps/cli/src/download.ts`

- Drop the `Destination` union, `resolveDestination`, `resolveConsoleAlias`,
  `ROOMBA_CONSOLE_PARAM`, `afterPlacement`, `resolvePostDownload`,
  `maybeRefresh`, `ensureDir`, the `CONSOLE_BY_ALIAS`/`planPostDownload`/
  `extractArchive`/`detectBatocera`/`romsDir`/`refreshLibrary` imports, and the
  "Console: …" announcement.
- `DownloadOptions` becomes `{ output?: string }`.
- Placement is always `await targetDir(options.output)` (Downloads by default,
  else `--output` file or directory — logic already present).
- After each `rename → "Saved to <finalDest>"` (the normal end-of-stream path
  **and** the `plan.action === "complete"` resume path), call
  `await runPostDownloadHook(dir, finalDest, url.href)`.

### Changed — `packages/core/src/index.ts`

- Remove `consoleFor` from the `RoomSource` interface.
- `export const ENGINE_API_VERSION = 3;`
- Remove the extraction re-exports (`SYSTEM_EXTENSIONS`, `acceptedExtensions`,
  `EXTRACTABLE`, `planPostDownload`, `PostDownloadPlan`).

### Changed — `apps/cli/src/index.ts`

- `download` command: remove `-c, --console` and `--no-refresh`; change
  `-o, --output` description to `"output file or directory (default: your
  Downloads folder)"`; action passes only `{ output: options.output }`.

### Deleted

- `apps/cli/src/batocera.ts` + `apps/cli/test/batocera.test.ts`
- `apps/cli/src/extract.ts` + `apps/cli/test/extract.test.ts`
- `packages/core/src/extensions.ts` + `packages/core/test/extensions.test.ts`

## Data flow

```
download → targetDir(output) → { dir, fixedFile }
  → stream to <partial> → rename to finalDest → "Saved to finalDest"
  → runPostDownloadHook(dir, finalDest, url.href)
       exists(dir/roomba.post-download.sh)?
         no  → return
         yes → sh <hook> <basename>  (cwd=dir, env ROOMBA_*)
                 exit 0     → done
                 non-zero   → warn, exit 0 anyway
```

## Error handling

- **Hook absent:** silent no-op.
- **Hook non-zero exit:** `roomba: post-download hook exited <code>` to stderr;
  roomba exits 0. The downloaded file is untouched.
- **`sh` missing (spawn error → code -1):** `roomba: could not run
  post-download hook (sh not found)`; exits 0.
- The hook never changes `process.exitCode`.

## Testing

Offline, injecting fakes (matches the existing `Fetcher`/`DetectDeps` style).

**`apps/cli/test/hooks.test.ts`** — inject `run` + `exists`:
- hook present, exit 0 → `run` called with `("sh", [hookPath, "Some Game.iso"],
  { cwd: dir, env })`; `env.ROOMBA_FILE` is the absolute path,
  `env.ROOMBA_FILENAME` the basename, `env.ROOMBA_URL` the url.
- hook present, non-zero exit → resolves without throwing; `run` was called.
- hook absent (`exists` → false) → `run` NOT called.

**`apps/cli/test/download.test.ts`** — delete the `resolveConsoleAlias`,
`resolveDestination`, and `resolvePostDownload` describe blocks (those functions
are gone); keep `resumePlan`, `parseContentDispositionFilename`,
`provisionalName`, `resolveFinalName`, `formatBytes`, `speedLabel`,
`resolveDownload`.

**Deleted test files:** `batocera.test.ts`, `extract.test.ts`,
`packages/core/test/extensions.test.ts`.

Full suite (`pnpm build && pnpm test`) green after the changes.

## Docs to update

- `README.md`: download example (Downloads default, no ROM-folder placement);
  command table (drop `-c/--console`, `--no-refresh`, adjust `-o`); architecture
  section (drop `consoleFor` mention); document the hook.
- `apps/cli/README.md`: same flag/behavior changes; hook reference.
- `docs/writing-engines.md`: remove `consoleFor` from the `RoomSource` contract
  description; note `ENGINE_API_VERSION` is now 3.

## Notes

- The `VERSION = "0.0.0"` constant in `packages/core/src/index.ts` is unused
  (`roomba --version` reads package.json). Left untouched — out of scope.
- The project-memory note "Batocera pivot — catalog source of truth = Batocera
  systems" stays accurate for the *catalog* (search/consoles); the placement
  pivot is being walked back. Update memory after implementation.
