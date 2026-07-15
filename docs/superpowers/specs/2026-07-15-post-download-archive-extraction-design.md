# Post-download archive extraction (Batocera)

**Date:** 2026-07-15
**Status:** Approved (design)

## Goal

On Batocera, after `roomba download <url>` places a file into
`/userdata/roms/<alias>/`, automatically **extract the archive when — and only
when — the target system can't read that archive format directly**, so the game
is playable without the user opening a terminal to unzip it.

```
$ roomba download "<psx-game.zip url>"
→ console: psx (Sony PlayStation)
→ /userdata/roms/psx/Some Game.zip     (psx accepts .cue/.bin/.chd/.iso — NOT .zip)
→ extract → /userdata/roms/psx/Some Game/{Some Game.cue, Some Game.bin}
→ delete Some Game.zip
→ ES rescans → game appears, playable

$ roomba download "<snes-game.zip url>"
→ console: snes (accepts .zip directly)
→ /userdata/roms/snes/Some Game.zip    → left as-is, plays immediately
```

This is the archive-extraction slice of "v3 — per-system readiness" deferred by
the Batocera integration spec (`2026-07-14-batocera-integration-design.md`).
BIOS provisioning and format conversion (`bin/cue`→`chd`) remain out of scope.

## Why this rule

Batocera systems disagree about archives, and the disagreement is load-bearing:

- **Cartridge cores** (nes, snes, gb, gba, megadrive, …) read `.zip`/`.7z`
  **directly** — extracting would just add clutter.
- **Arcade** (mame, fbneo, neogeo, model2/3, naomi, atomiswave, …) *require*
  the `.zip`/`.7z` — **the archive is the romset**; extracting it **breaks the
  game**.
- **Most disc systems** (psx accepts only `.cue .img .mdf .pbp .toc .cbn .m3u
  .ccd .chd .iso`; dreamcast; ps2) do **not** accept `.zip`, so a downloaded
  archive must be unpacked before the disc image is visible.

The precise, non-guessing rule is therefore: **extract iff the downloaded
file's extension is NOT in the target system's accepted-extensions list.** That
list is authoritative Batocera data (each system's `_info.txt` publishes it),
which also guarantees we never touch an arcade romset.

## Decisions (from brainstorming)

1. **Decide rule:** accepted-extensions catalog per alias (not an
   extract-list or a denylist).
2. **Layout:** extract into a **subfolder per archive**,
   `/userdata/roms/<alias>/<archive-basename>/` — avoids filename collisions
   (many discs share names like `track01.bin`); ES scans subfolders.
3. **On success:** **delete** the original archive (it's not runnable by the
   system, that's why we extracted; keeping it wastes space and can show as a
   junk entry). Delete **only** after a verified exit-0 extraction.
4. **Extractable formats:** `.zip`, `.7z`, `.rar`. Anything else that isn't
   accepted is left in place with a warning.
5. **Failure posture:** best-effort, mirroring `refreshLibrary` — a missing
   `7z` binary or a non-zero exit **warns and keeps the archive**; never
   crashes, never deletes on failure. The download is already safe on disk.

## Scope

**In:** accepted-extensions catalog for every `CONSOLES` alias; a pure
placement decision; a `7z`-based extraction executor; wiring into `download.ts`
after ROM placement; best-effort failure handling; tests.

**Out (non-goals):**
- Non-Batocera placement (`-o` / `~/Downloads`) — always keeps the raw file.
- Formats other than `.zip`/`.7z`/`.rar` (no `.tar.gz`, no split `.7z.001`
  volumes, no password-protected archives).
- `.m3u` playlist generation for multi-disc sets.
- Launcher/sentinel-file creation (`.game`, `.quake`, `.d3`, DOS `dosbox.bat`,
  scummvm short-names, …) — a separate future feature if an engine ever serves
  standalone-engine/port games.
- BIOS provisioning and format conversion (`bin/cue`→`chd`, `pbp`).

## Architecture

Respects roomba's existing split: **core owns vocabulary + catalog + pure
decisions; the CLI owns I/O and Batocera specifics.**

### core — catalog data

`packages/core/src/extensions.ts`

```ts
/**
 * Accepted ROM-file extensions per Batocera system alias, sourced from each
 * system's _info.txt "ROM files extensions accepted" line. Lowercase, no
 * leading dot. THE authority for whether a downloaded file is runnable as-is.
 */
export const SYSTEM_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  snes: ["smc", "fig", "sfc", "gd3", "gd7", "dx2", "bsx", "swc", "zip", "7z"],
  psx: ["cue", "img", "mdf", "pbp", "toc", "cbn", "m3u", "ccd", "chd", "iso"],
  mame: ["zip", "7z"],
  // …one entry per CONSOLES alias, populated from the _info.txt dump…
};

/** Accepted extensions for an alias (empty array if the alias is unknown). */
export function acceptedExtensions(alias: string): readonly string[];
```

Exported from `packages/core/src/index.ts`.

A **drift test** asserts `CONSOLES.every(c => alias in SYSTEM_EXTENSIONS)` so
the two catalogs can't diverge.

### core — pure decision

`packages/core/src/extensions.ts` (same module)

```ts
/** The set of archive formats roomba can extract. */
export const EXTRACTABLE = ["zip", "7z", "rar"] as const;

export type PostDownloadPlan =
  | { kind: "keep" }                          // extension accepted → leave it
  | { kind: "extract"; archive: string }      // not accepted, extractable → unpack
  | { kind: "manual"; ext: string };          // not accepted, not extractable → warn

/**
 * Decide what to do with a file just placed in an alias's ROM folder.
 * `filename` is the final on-disk name; the extension is its last dot segment,
 * lowercased. Pure — no I/O. Callers apply it only for Batocera ROM placement.
 */
export function planPostDownload(alias: string, filename: string): PostDownloadPlan;
```

Truth table:

| system accepts ext? | ext extractable? | plan |
|---|---|---|
| yes | — | `keep` |
| no | yes (`zip`/`7z`/`rar`) | `extract` |
| no | no | `manual` |

Examples: `planPostDownload("snes","g.zip") → keep`;
`planPostDownload("mame","x.zip") → keep`;
`planPostDownload("psx","g.zip") → extract`;
`planPostDownload("psx","g.chd") → keep`;
`planPostDownload("psx","g.rar") → extract`;
`planPostDownload("psx","g.iso") → keep`;
`planPostDownload("psx","g.rev") → manual`.

### CLI — extraction executor

`apps/cli/src/extract.ts`

```ts
/** Injectable process runner (default: real spawn). Mirrors batocera.ts's DetectDeps. */
export interface ExtractDeps {
  run?: (cmd: string, args: string[]) => Promise<{ code: number }>;
}

export interface ExtractResult {
  ok: boolean;
  /** Destination subfolder the archive was extracted into. */
  dir: string;
}

/**
 * Extract `archivePath` into `/userdata/roms/<alias>/<basename-without-ext>/`
 * using 7z (`7z x -o<dir> -y <archive>`), then unlink the archive ONLY on
 * exit 0. Best-effort: a missing binary / non-zero exit warns to stderr,
 * keeps the archive, and resolves ok:false. Never throws.
 */
export async function extractArchive(
  archivePath: string,
  deps?: ExtractDeps,
): Promise<ExtractResult>;
```

`7z` handles `.zip`, `.7z`, and `.rar` (the last via its RAR codec; if the
codec is absent the non-zero exit falls through to the best-effort warning).
The subfolder is `mkdir -p`'d before extraction.

### CLI — wiring

`apps/cli/src/download.ts`

Add `afterPlacement(destination, finalDest, options)` that, for a
`kind: "roms"` destination, computes `planPostDownload(alias, basename(finalDest))`
and acts:

- `keep` → nothing.
- `extract` → `extractArchive(finalDest)`; on success log
  `Extracted to <dir>/`.
- `manual` → warn `roomba: <system> doesn't accept .<ext>; unpack it manually
  in <romsDir>`.

Then always call `maybeRefresh(destination, options.noRefresh)`.

`afterPlacement` **replaces the two current `maybeRefresh` call sites** — the
normal streamed path and the `plan.action === "complete"` resume path — so both
run extraction. `finalDest` is already computed above both branches.

## Data flow

```
download → rename(.part → finalDest) [kind:"roms"]
  → afterPlacement(destination, finalDest)
      → planPostDownload(alias, basename(finalDest))
          keep    → (nothing)
          extract → extractArchive → 7z x → unlink archive (exit 0) → log
          manual  → warn
      → maybeRefresh (EmulationStation restart)
```

## Error handling

- **Missing `7z`** (spawn `error` event) → warn, keep archive, `ok:false`,
  refresh still runs.
- **Non-zero 7z exit** (bad/partial/password/rar-codec-missing) → warn, keep
  archive (do NOT unlink), `ok:false`.
- **`manual` plan** → warn with the offending extension and the folder; leave
  the file; refresh still runs (it may still be visible/partly usable).
- Extraction never changes `process.exitCode`; placement already succeeded.

## Testing

Offline, matching the repo's fake-injection style (`Fetcher`, `DetectDeps`):

**core (`packages/core/test/extensions.test.ts`)**
- `planPostDownload` truth-table cases (keep/extract/manual) across snes, mame,
  psx, and an unknown alias.
- Case-insensitive extension handling (`.ZIP` → extract for psx).
- Drift test: every `CONSOLES` alias has a `SYSTEM_EXTENSIONS` entry.

**CLI (`apps/cli/test/extract.test.ts`)** — inject a fake `run`:
- exit 0 → archive unlinked, `dir` is the basename subfolder, `ok:true`.
- non-zero exit → archive retained, `ok:false`.
- spawn error (missing binary) → retained, `ok:false`, warning emitted.

**CLI (`apps/cli/test/download.test.ts`)** — extend:
- roms + non-accepted archive → extraction invoked, then refresh.
- roms + accepted extension → extraction NOT invoked.
- non-roms (`-o`) → extraction NOT invoked regardless of extension.

## YAGNI notes

No config knobs (keep-archive toggle, custom extractor path) until asked. No
recursive re-extraction of archives found *inside* an archive. No detection of
which extracted file is "the" ROM — ES scans the subfolder.
