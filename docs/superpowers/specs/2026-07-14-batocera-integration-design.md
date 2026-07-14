# Batocera integration (v1: detect, place, appear)

**Date:** 2026-07-14
**Status:** Approved (design)

## Goal

On Batocera, `roomba download <url>` should land the ROM in the correct
`/userdata/roms/<system>/` folder and make it show up in EmulationStation,
playable, with **one command and no user input** in the common case:

```
$ roomba download "https://dl3.vimm.net/?mediaId=44190"
→ detects Batocera
→ console: snes            (resolved by the engine from the URL)
→ /userdata/roms/snes/Resident Evil 2 (Europe) (Disc 1).7z
→ ES rescans → game appears, playable
```

Off Batocera, `download` behaves exactly as it does today (saves to
`~/Downloads`, or to `-o`).

## Scope

**In (v1):** Batocera detection; a console catalog whose vocabulary *is*
Batocera's systems; a per-engine URL→console resolver; a `--console` override;
placement into the right ROM folder; a best-effort library refresh so the game
appears without a reboot; and two download-feedback touches — showing the
detected console and the live transfer speed (bandwidth).

**Deferred (own specs):**
- **v2 — rich scraping.** Batocera has no working headless scraper
  (`emulationstation --scrape` is flagged broken on the wiki), so populating
  box art / description / video means roomba calling the **ScreenScraper.fr**
  API itself — credentials, rate limits, media downloads, `gamelist.xml`
  authoring. Substantial; separate spec.
- **v3 — per-system readiness.** BIOS provisioning, format conversion
  (`bin/cue`→`chd`, `pbp`), and archive extraction where a system can't read
  `.zip`/`.7z` directly.

### Known v1 limitation

The file is placed **as downloaded** (engines commonly serve `.7z`/`.zip`).
Many libretro cores read archives directly, so those play immediately;
disc-based systems needing `.chd`/`.pbp` will appear but won't launch until v3.
This is documented, not silently ignored.

## Why the catalog moves to Batocera

roomba is turning its cannons to Batocera, so Batocera's systems become the
single source of truth for the console catalog. The alias *is* the ROM folder
name (`snes`, `psx`, `megadrive`, `gc`, …). This collapses what would otherwise
be two mapping layers (roomba alias → Batocera folder) into one: an engine maps
its internal id straight onto a Batocera alias, and that alias directly names
`/userdata/roms/<alias>/`.

Consequence: user-facing aliases change (`ps1`→`psx`, `genesis`→`megadrive`).
Acceptable — Batocera system names are the retro-community lingua franca.

### Catalog data sources

Two complementary, cross-checking sources:

- **ROM folder list** (the ~250 folders under `/userdata/roms`) —
  **authoritative for membership and the `alias`.** Placement ground truth: an
  alias must be a real folder.
- **Batocera wiki `systems` page** (<https://wiki.batocera.org/systems>) —
  supplies the human **`name`** and the hardware **`category`**. The wiki warns
  its shortname equals the folder name "*most of the time*", so it decorates but
  never defines membership.

Reconciliation rules:
- A folder with no wiki entry → keep it; `name` falls back to the alias.
- A wiki entry with no folder (e.g. `gong`, `mame/model1`) → drop it.
- On any alias/name conflict, the **folder wins** for the alias.

## Core changes (`@praser/roomba-core`)

### Catalog (`consoles.ts`, rebuilt) + category

`Console` gains a required `category`:

```ts
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
```

`CONSOLES` is regenerated from the two sources above; `CONSOLE_BY_ALIAS` stays.
Category is taken from the wiki section a system appears under (Arcade / Home
console / Portable game console / Home computer / Port, Flatpak & Misc). A
folder with no wiki section defaults to `"port"` (the miscellaneous bucket).

### Contract: `consoleFor` + version bump

Add one method to `RoomSource`, separate from `downloadRequest`:

```ts
interface RoomSource {
  // …
  /**
   * If this source recognizes the URL, return the catalog alias of the console
   * it belongs to (e.g. "snes"); otherwise null. May be async: an engine can
   * navigate intermediate pages (via its injected Fetcher) to determine it.
   */
  consoleFor(url: URL): Awaitable<string | null>;
}
```

Adding a required method is a breaking contract change:

```ts
export const ENGINE_API_VERSION = 2; // was 1
```

roomba already refuses to load an engine whose `apiVersion` differs, so v1
engines fail cleanly with a reinstall prompt rather than misbehaving.

## CLI changes (`apps/cli`)

### New `batocera.ts` — all Batocera-specific I/O

```ts
/** Paths detection reads; overridable so tests point at fixtures. */
export interface DetectDeps {
  osReleasePath?: string; // default "/etc/os-release"
  romsPath?: string;      // default "/userdata/roms"
}
/** True when running on a Batocera system. */
export function detectBatocera(deps?: DetectDeps): boolean;
/** Absolute ROM folder for a catalog alias: /userdata/roms/<alias>. */
export function romsDir(alias: string): string;
/** Best-effort library refresh so a new ROM appears without a reboot. */
export async function refreshLibrary(): Promise<void>;
```

- **`detectBatocera`** — true iff the os-release file contains `batocera`
  (case-insensitive) **and** the roms path exists. Both, to avoid false
  positives on a dev machine that merely has an `/userdata` dir. `DetectDeps`
  lets tests substitute fixture paths; production calls it with no args.
- **`romsDir`** — `join("/userdata/roms", alias)`.
- **`refreshLibrary`** — spawn `batocera-es-swissknife --restart`. Best-effort:
  if the binary is missing or exits non-zero, warn to stderr and return; never
  throw (the ROM is already in place). The ES web API on port 1234 is *not*
  used — it requires the user to have enabled public web access + rebooted, so
  it isn't a reliable default.

### `download` command + `download.ts`

New options on the `download` command:
- `--console <alias>` — force the console (for URLs an engine can't
  disambiguate).
- `--no-refresh` — skip the ES restart.

`download.ts` refactor so it stays I/O-focused and testable:
- `pickDownloadRequest` returns `{ source, request }` (not just the request),
  so we can call `consoleFor` on the **same** matching source.
- The destination-directory decision moves out of `downloadFile`. `downloadFile`
  receives an already-resolved target directory (or fixed `-o` file); its
  streaming/resume logic is otherwise untouched.

Destination resolution (in the command action, before streaming):

1. `-o` given → use it (unchanged behavior; Batocera logic skipped).
2. `detectBatocera()` is false → `~/Downloads` (unchanged).
3. On Batocera:
   - `alias = options.console ?? await source.consoleFor(url)`
   - validate `alias` against `CONSOLE_BY_ALIAS`;
   - target dir = `romsDir(alias)` (created if missing).

After a successful save on Batocera, unless `--no-refresh`, call
`refreshLibrary()`.

### Download feedback (both additions apply here)

- **Detected console line.** Once a console is resolved (via `--console` or
  `consoleFor`), print it before streaming, e.g.
  `Console: snes (Super Nintendo Entertainment System)` — looked up from
  `CONSOLE_BY_ALIAS`. Only shown when a console was resolved (i.e. on Batocera,
  or whenever `--console` is passed); silent otherwise so desktop output is
  unchanged apart from the speed below.
- **Bandwidth in the progress line.** Extend `progressReporter` (in
  `download.ts`) to show current transfer speed alongside the existing
  bytes/total/percent, e.g.
  `Downloading… 120 MB / 330 MB (36.4%) 8.7 MB/s`. Speed is a short rolling
  average (bytes since the last print ÷ elapsed) rather than the cumulative
  average, so it reflects live throughput. Applies to **every** download,
  Batocera or not. Reuses the existing `formatBytes` helper (append `/s`).

### Errors

- On Batocera, `consoleFor` returns `null` and no `--console`:
  `Couldn't determine the console for this URL — pass --console <alias> (see \`roomba consoles\`).`
- `--console` value not in `CONSOLE_BY_ALIAS`: `Unknown console '<alias>' — see \`roomba consoles\`.`
- ROM folder not writable: surface the fs error with the attempted path.
- `refreshLibrary` failure: warn, don't fail the command.

## Testing

- **core**
  - `CONSOLES` includes representative aliases (`snes`, `psx`, `megadrive`,
    `gc`) with correct `category`; every alias resolves via `CONSOLE_BY_ALIAS`;
    no dropped-wiki-only aliases (`gong`) present.
  - a fake engine implementing `consoleFor` satisfies the v2 `RoomSource` type;
    `ENGINE_API_VERSION === 2`.
- **cli/batocera**
  - `detectBatocera` true only when both signals present; false otherwise
    (inject the os-release reader + fs check).
  - `romsDir("snes")` → `/userdata/roms/snes`.
  - `refreshLibrary` spawns `batocera-es-swissknife --restart` (mock spawn); a
    spawn error is swallowed (no throw).
- **cli/download**
  - destination matrix: `-o` wins everywhere; non-Batocera → Downloads;
    Batocera → `romsDir(consoleFor)`; Batocera + `--console` overrides
    `consoleFor`.
  - resolution order `--console → consoleFor → error`; unknown alias errors;
    `null` console without `--console` errors.
  - `--no-refresh` skips the restart; default triggers it once, after save.
  - detected-console line prints alias + name when a console is resolved, and
    is absent when none is (plain desktop download).
  - `progressReporter` includes a `MB/s` speed figure; speed is computed from
    bytes-since-last-print over elapsed time (unit-test the calculation with
    fixed byte/time inputs).
  - existing download/resume tests still pass against the refactored signature.

## Rollout

1. Release `@praser/roomba-core` (major bump for `ENGINE_API_VERSION` 2 +
   `Console.category`) and the CLI via the roomba release pipeline.
2. Update engines to API v2: implement `consoleFor`, remap internal ids onto
   Batocera aliases, rebuild, republish. `roomba-vimm` is the reference engine
   and an out-of-tree dependency of this spec.
3. Users reinstall engines (`roomba engine install <url>`); v1 engines are
   refused with a clear message until updated.
