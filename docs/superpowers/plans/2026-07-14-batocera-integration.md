# Batocera Integration (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Batocera, `roomba download <url>` places the ROM in the correct `/userdata/roms/<system>/` folder and refreshes EmulationStation so the game appears and is playable — with one command and no user input in the common case.

**Architecture:** The console catalog's vocabulary becomes Batocera's systems (alias = ROM-folder name), so an engine maps its internal id straight onto a folder. A new `RoomSource.consoleFor(url)` lets `download` recover the console from a bare URL; a `--console` flag overrides it. A new `apps/cli/src/batocera.ts` isolates all Batocera I/O (detection, roms dir, library refresh). `download.ts` keeps its streaming/resume logic and gains a pure destination resolver plus a transfer-speed readout.

**Tech Stack:** TypeScript (ESM, NodeNext), Node ≥ 22, pnpm workspaces, Vitest, commander.

## Global Constraints

- **Node ≥ 22**; package manager `pnpm@10.28.2`. Copy these exactly; do not change.
- **Engines depend only on `@praser/roomba-core`.** Core stays I/O-free (static data + types only).
- **`ENGINE_API_VERSION` becomes `2`** (breaking: a required method is added to `RoomSource`). roomba refuses to load engines whose `apiVersion` differs.
- **`Console.alias` IS the Batocera ROM-folder name** (the placement target) — e.g. `psx` not `ps1`, `megadrive` not `genesis`. Folder names may contain `+`, `_`, `-`, digits (e.g. `msx2+`, `windows_installers`, `snes-msu1`).
- **Catalog membership = the Batocera ROM-folder list.** The wiki systems page supplies `name` + `category` only; a folder with no wiki entry gets `name = alias`, `category = "port"`.
- **TDD, frequent commits.** Every ESM import of a local file uses the `.js` extension (NodeNext), even from `.ts` sources.
- Run all tests with `pnpm test` (root, `vitest run`). Run one file with `pnpm test <path>`.
- Import roomba-core in the CLI from `@praser/roomba-core`; import within a package via relative `../src/...js`.

---

### Task 1: Core — `Console.category` + catalog rebuilt from Batocera

**Files:**
- Modify: `packages/core/src/index.ts` (add `ConsoleCategory`, extend `Console`)
- Modify: `packages/core/src/consoles.ts` (rebuild `CONSOLES`)
- Test: `packages/core/test/consoles.test.ts` (update expectations)

**Interfaces:**
- Produces: `ConsoleCategory` union; `Console` = `{ name: string; alias: string; category: ConsoleCategory }`; `CONSOLES: readonly Console[]`; `CONSOLE_BY_ALIAS: ReadonlyMap<string, Console>`.

- [ ] **Step 1: Update the catalog tests to the new shape**

Replace the body of `packages/core/test/consoles.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { CONSOLE_BY_ALIAS, CONSOLES } from "../src/index.js";

describe("console catalog", () => {
  it("uses unique, Batocera-folder-formatted aliases", () => {
    const aliases = CONSOLES.map((c) => c.alias);
    expect(new Set(aliases).size).toBe(aliases.length); // no duplicates
    for (const alias of aliases) {
      // Batocera folder names: lowercase alnum plus . _ + - (e.g. msx2+, windows_installers)
      expect(alias).toMatch(/^[a-z0-9][a-z0-9._+-]*$/);
    }
  });

  it("has a non-empty name and a category for every entry", () => {
    const categories = new Set(["arcade", "home-console", "portable", "home-computer", "port"]);
    for (const console of CONSOLES) {
      expect(console.name.length).toBeGreaterThan(0);
      expect(categories.has(console.category)).toBe(true);
    }
  });

  it("uses Batocera system names as aliases", () => {
    expect(CONSOLE_BY_ALIAS.get("psx")?.name).toBe("Sony PlayStation");
    expect(CONSOLE_BY_ALIAS.get("megadrive")?.name).toBe("Sega Genesis / Mega Drive");
    expect(CONSOLE_BY_ALIAS.get("snes")?.category).toBe("home-console");
    expect(CONSOLE_BY_ALIAS.get("gba")?.category).toBe("portable");
    // wiki-only systems with no ROM folder are excluded
    expect(CONSOLE_BY_ALIAS.get("gong")).toBeUndefined();
  });

  it("CONSOLE_BY_ALIAS resolves every alias", () => {
    expect(CONSOLE_BY_ALIAS.size).toBe(CONSOLES.length);
    expect(CONSOLE_BY_ALIAS.get("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test packages/core/test/consoles.test.ts`
Expected: FAIL — `category` missing / `psx` not found (catalog not rebuilt yet).

- [ ] **Step 3: Add `ConsoleCategory` and extend `Console` in `index.ts`**

Replace the existing `Console` interface (lines 3–8) in `packages/core/src/index.ts` with:

```ts
/** Hardware category from the Batocera systems page. */
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

- [ ] **Step 4: Rebuild `consoles.ts` with the Batocera catalog**

Replace the entire contents of `packages/core/src/consoles.ts` with:

```ts
import type { Console } from "./index.js";

/**
 * The canonical catalog of consoles roomba knows about — sourced from Batocera.
 * `alias` is the Batocera ROM-folder name (the placement target under
 * /userdata/roms/<alias>). `name` and `category` come from the Batocera systems
 * wiki (https://wiki.batocera.org/systems); folders with no wiki entry fall back
 * to name = alias, category = "port". Engines map their internal ids onto these
 * aliases; `roomba consoles` only shows the ones an installed engine maps.
 */
export const CONSOLES: readonly Console[] = [
  // --- Arcade ---
  { name: "Multiple Arcade Machine Emulator (MAME)", alias: "mame", category: "arcade" },
  { name: "FinalBurn Neo", alias: "fbneo", category: "arcade" },
  { name: "Discrete Integrated Circuit Emulator (DICE)", alias: "dice", category: "arcade" },
  { name: "DAPHNE (Laserdisc)", alias: "daphne", category: "arcade" },
  { name: "Singe (Laserdisc)", alias: "singe", category: "arcade" },
  { name: "Namco System 22", alias: "namco22", category: "arcade" },
  { name: "Sega Model 2", alias: "model2", category: "arcade" },
  { name: "Sega Model 3", alias: "model3", category: "arcade" },
  { name: "Sega NAOMI", alias: "naomi", category: "arcade" },
  { name: "Sega NAOMI 2", alias: "naomi2", category: "arcade" },
  { name: "Namco System 246/256", alias: "namco2x6", category: "arcade" },
  { name: "Sega Hikaru", alias: "hikaru", category: "arcade" },
  { name: "Gaelco 3D", alias: "gaelco", category: "arcade" },
  { name: "Sega Chihiro", alias: "chihiro", category: "arcade" },
  { name: "Triforce", alias: "triforce", category: "arcade" },
  { name: "Sammy Atomiswave", alias: "atomiswave", category: "arcade" },
  { name: "Cave CV1000", alias: "cave3rd", category: "arcade" },
  { name: "Sega System SP", alias: "systemsp", category: "arcade" },
  { name: "Sega Lindbergh", alias: "lindbergh", category: "arcade" },

  // --- Home console ---
  { name: "Fairchild Channel F", alias: "channelf", category: "home-console" },
  { name: "Atari 2600", alias: "atari2600", category: "home-console" },
  { name: "Magnavox Odyssey²", alias: "odyssey2", category: "home-console" },
  { name: "Bally Astrocade", alias: "astrocade", category: "home-console" },
  { name: "APF-MP1000", alias: "apfm1000", category: "home-console" },
  { name: "Interton VC 4000", alias: "vc4000", category: "home-console" },
  { name: "Intellivision", alias: "intellivision", category: "home-console" },
  { name: "Bandai Super Vision 8000", alias: "sv8000", category: "home-console" },
  { name: "Epoch Cassette Vision", alias: "cassettevision", category: "home-console" },
  { name: "Atari 5200", alias: "atari5200", category: "home-console" },
  { name: "ColecoVision", alias: "colecovision", category: "home-console" },
  { name: "Entex Adventure Vision", alias: "advision", category: "home-console" },
  { name: "Vectrex", alias: "vectrex", category: "home-console" },
  { name: "VTech CreatiVision", alias: "crvision", category: "home-console" },
  { name: "Emerson Arcadia 2001", alias: "arcadia", category: "home-console" },
  { name: "Nintendo Entertainment System", alias: "nes", category: "home-console" },
  { name: "Sega SG-1000", alias: "sg1000", category: "home-console" },
  { name: "Othello Multivision", alias: "multivision", category: "home-console" },
  { name: "Philips Videopac+ G7400", alias: "videopacplus", category: "home-console" },
  { name: "Casio PV-1000", alias: "pv1000", category: "home-console" },
  { name: "Casio PV-2000", alias: "pv2000", category: "home-console" },
  { name: "Gakken Compact Vision TV Boy", alias: "ctvboy", category: "home-console" },
  { name: "Epoch Super Cassette Vision", alias: "scv", category: "home-console" },
  { name: "Sega Master System", alias: "mastersystem", category: "home-console" },
  { name: "Famicom Disk System", alias: "fds", category: "home-console" },
  { name: "Atari 7800", alias: "atari7800", category: "home-console" },
  { name: "VTech Socrates", alias: "socrates", category: "home-console" },
  { name: "PC Engine / TurboGrafx-16", alias: "pcengine", category: "home-console" },
  { name: "Sega Genesis / Mega Drive", alias: "megadrive", category: "home-console" },
  { name: "PC Engine CD-ROM² / TurboGrafx-CD", alias: "pcenginecd", category: "home-console" },
  { name: "PC Engine SuperGrafx", alias: "supergrafx", category: "home-console" },
  { name: "Super Nintendo Entertainment System", alias: "snes", category: "home-console" },
  { name: "Neo Geo", alias: "neogeo", category: "home-console" },
  { name: "Philips CD-i", alias: "cdi", category: "home-console" },
  { name: "Commodore CDTV", alias: "amigacdtv", category: "home-console" },
  { name: "Amstrad GX4000", alias: "gx4000", category: "home-console" },
  { name: "Sega CD / Mega-CD", alias: "megacd", category: "home-console" },
  { name: "SNES MSU-1", alias: "snes-msu1", category: "home-console" },
  { name: "Sega Pico", alias: "pico", category: "home-console" },
  { name: "Super Game Boy", alias: "sgb", category: "home-console" },
  { name: "Super A'Can", alias: "supracan", category: "home-console" },
  { name: "Mega Drive MSU-MD", alias: "megadrive-msu", category: "home-console" },
  { name: "Super Game Boy MSU-1", alias: "sgb-msu1", category: "home-console" },
  { name: "Atari Jaguar", alias: "jaguar", category: "home-console" },
  { name: "3DO Interactive Multiplayer", alias: "3do", category: "home-console" },
  { name: "Amiga CD32", alias: "amigacd32", category: "home-console" },
  { name: "Sega 32X", alias: "sega32x", category: "home-console" },
  { name: "Sony PlayStation", alias: "psx", category: "home-console" },
  { name: "NEC PC-FX", alias: "pcfx", category: "home-console" },
  { name: "Neo Geo CD", alias: "neogeocd", category: "home-console" },
  { name: "Sega Saturn", alias: "saturn", category: "home-console" },
  { name: "Casio Loopy", alias: "loopy", category: "home-console" },
  { name: "Virtual Boy", alias: "virtualboy", category: "home-console" },
  { name: "Satellaview", alias: "satellaview", category: "home-console" },
  { name: "Atari Jaguar CD", alias: "jaguarcd", category: "home-console" },
  { name: "SuFami Turbo", alias: "sufami", category: "home-console" },
  { name: "Nintendo 64", alias: "n64", category: "home-console" },
  { name: "Sega Dreamcast", alias: "dreamcast", category: "home-console" },
  { name: "Nintendo 64DD", alias: "n64dd", category: "home-console" },
  { name: "Sony PlayStation 2", alias: "ps2", category: "home-console" },
  { name: "Nintendo GameCube", alias: "gamecube", category: "home-console" },
  { name: "Microsoft Xbox", alias: "xbox", category: "home-console" },
  { name: "Plug & Play TV Games", alias: "tvgames", category: "home-console" },
  { name: "Sega Advanced Pico Beena", alias: "beena", category: "home-console" },
  { name: "VTech V.Smile", alias: "vsmile", category: "home-console" },
  { name: "Microsoft Xbox 360", alias: "xbox360", category: "home-console" },
  { name: "Nintendo Wii", alias: "wii", category: "home-console" },
  { name: "Sony PlayStation 3", alias: "ps3", category: "home-console" },
  { name: "Nintendo Wii U", alias: "wiiu", category: "home-console" },
  { name: "Sony PlayStation 4", alias: "ps4", category: "home-console" },
  { name: "Uzebox", alias: "uzebox", category: "home-console" },
  { name: "PICO-8", alias: "pico8", category: "home-console" },
  { name: "TIC-80", alias: "tic80", category: "home-console" },
  { name: "LowRes NX", alias: "lowresnx", category: "home-console" },
  { name: "WASM-4", alias: "wasm4", category: "home-console" },
  { name: "Pyxel", alias: "pyxel", category: "home-console" },
  { name: "Vircon32", alias: "vircon32", category: "home-console" },

  // --- Portable ---
  { name: "Nintendo Game & Watch", alias: "gameandwatch", category: "portable" },
  { name: "Handheld LCD Games", alias: "lcdgames", category: "portable" },
  { name: "Epoch Game Pocket Computer", alias: "gamepock", category: "portable" },
  { name: "Game Boy", alias: "gb", category: "portable" },
  { name: "Game Boy (2 Players)", alias: "gb2players", category: "portable" },
  { name: "Atari Lynx", alias: "lynx", category: "portable" },
  { name: "Sega Game Gear", alias: "gamegear", category: "portable" },
  { name: "Bit Corporation Gamate", alias: "gamate", category: "portable" },
  { name: "Hartung Game Master", alias: "gmaster", category: "portable" },
  { name: "Watara Supervision", alias: "supervision", category: "portable" },
  { name: "Mega Duck / Cougar Boy", alias: "megaduck", category: "portable" },
  { name: "Tiger Game.com", alias: "gamecom", category: "portable" },
  { name: "Game Boy Color", alias: "gbc", category: "portable" },
  { name: "Game Boy Color (2 Players)", alias: "gbc2players", category: "portable" },
  { name: "Neo Geo Pocket", alias: "ngp", category: "portable" },
  { name: "Neo Geo Pocket Color", alias: "ngpc", category: "portable" },
  { name: "Bandai WonderSwan", alias: "wswan", category: "portable" },
  { name: "Bandai WonderSwan Color", alias: "wswanc", category: "portable" },
  { name: "Game Boy Advance", alias: "gba", category: "portable" },
  { name: "Nintendo Pokémon Mini", alias: "pokemini", category: "portable" },
  { name: "GamePark GP32", alias: "gp32", category: "portable" },
  { name: "Nintendo DS", alias: "nds", category: "portable" },
  { name: "PlayStation Portable", alias: "psp", category: "portable" },
  { name: "Nintendo 3DS", alias: "3ds", category: "portable" },
  { name: "PlayStation Vita", alias: "psvita", category: "portable" },
  { name: "Arduboy", alias: "arduboy", category: "portable" },

  // --- Home computer ---
  { name: "DEC PDP-1", alias: "pdp1", category: "home-computer" },
  { name: "Apple II", alias: "apple2", category: "home-computer" },
  { name: "Commodore PET", alias: "pet", category: "home-computer" },
  { name: "TRS-80", alias: "trs80", category: "home-computer" },
  { name: "Sharp MZ-80K", alias: "mz80k", category: "home-computer" },
  { name: "Atari 800", alias: "atari800", category: "home-computer" },
  { name: "Acorn Atom", alias: "atom", category: "home-computer" },
  { name: "Texas Instruments TI-99/4A", alias: "ti99", category: "home-computer" },
  { name: "NEC PC-8001", alias: "pc80", category: "home-computer" },
  { name: "Commodore VIC-20", alias: "c20", category: "home-computer" },
  { name: "TRS-80 Color Computer", alias: "coco", category: "home-computer" },
  { name: "NEC PC-6000", alias: "pc60", category: "home-computer" },
  { name: "NEC PC-8800", alias: "pc88", category: "home-computer" },
  { name: "Sinclair ZX81", alias: "zx81", category: "home-computer" },
  { name: "BBC Micro", alias: "bbcmicro", category: "home-computer" },
  { name: "Sharp X1", alias: "x1", category: "home-computer" },
  { name: "ZX Spectrum", alias: "zxspectrum", category: "home-computer" },
  { name: "Commodore 64", alias: "c64", category: "home-computer" },
  { name: "NEC PC-9800", alias: "pc98", category: "home-computer" },
  { name: "Fujitsu FM-7", alias: "fm7", category: "home-computer" },
  { name: "Tomy Tutor", alias: "tutor", category: "home-computer" },
  { name: "EACA Colour Genie", alias: "cgenie", category: "home-computer" },
  { name: "Sharp MZ-700", alias: "mz700", category: "home-computer" },
  { name: "Sharp MZ-2000", alias: "mz2000", category: "home-computer" },
  { name: "Acorn Electron", alias: "electron", category: "home-computer" },
  { name: "Camputers Lynx", alias: "camplynx", category: "home-computer" },
  { name: "MSX", alias: "msx1", category: "home-computer" },
  { name: "Coleco Adam", alias: "adam", category: "home-computer" },
  { name: "Spectravideo", alias: "spectravideo", category: "home-computer" },
  { name: "Bandai RX-78", alias: "rx78", category: "home-computer" },
  { name: "Sega SC-3000", alias: "sc3000", category: "home-computer" },
  { name: "TRS-80 MC-10", alias: "mc10", category: "home-computer" },
  { name: "Dragon 64", alias: "dragon64", category: "home-computer" },
  { name: "Amstrad CPC", alias: "amstradcpc", category: "home-computer" },
  { name: "Apple Macintosh", alias: "macintosh", category: "home-computer" },
  { name: "Thomson MO/TO", alias: "thomson", category: "home-computer" },
  { name: "Commodore Plus/4", alias: "cplus4", category: "home-computer" },
  { name: "VTech Laser 310", alias: "laser310", category: "home-computer" },
  { name: "Oric Atmos", alias: "oricatmos", category: "home-computer" },
  { name: "Sharp MZ-800", alias: "mz800", category: "home-computer" },
  { name: "Atari ST", alias: "atarist", category: "home-computer" },
  { name: "MSX2", alias: "msx2", category: "home-computer" },
  { name: "Commodore 128", alias: "c128", category: "home-computer" },
  { name: "Enterprise", alias: "enterprise", category: "home-computer" },
  { name: "Amstrad PCW", alias: "pcw", category: "home-computer" },
  { name: "Elektronika BK", alias: "bk", category: "home-computer" },
  { name: "Sharp MZ-2500", alias: "mz2500", category: "home-computer" },
  { name: "Apple IIGS", alias: "apple2gs", category: "home-computer" },
  { name: "Sega AI Computer", alias: "segaai", category: "home-computer" },
  { name: "Videoton TVC", alias: "tvc", category: "home-computer" },
  { name: "Acorn Archimedes", alias: "archimedes", category: "home-computer" },
  { name: "Atari XEGS", alias: "xegs", category: "home-computer" },
  { name: "Amiga 500", alias: "amiga500", category: "home-computer" },
  { name: "Sharp X68000", alias: "x68000", category: "home-computer" },
  { name: "MSX2+", alias: "msx2+", category: "home-computer" },
  { name: "Fujitsu FM Towns", alias: "fmtowns", category: "home-computer" },
  { name: "SAM Coupé", alias: "samcoupe", category: "home-computer" },
  { name: "Amiga 1200", alias: "amiga1200", category: "home-computer" },
  { name: "Tandy VIS", alias: "vis", category: "home-computer" },
  { name: "MSX turboR", alias: "msxturbor", category: "home-computer" },
  { name: "Commander X16", alias: "commanderx16", category: "home-computer" },

  // --- Port, Flatpak & Miscellaneous ---
  { name: "DOS (DOSBox)", alias: "dos", category: "port" },
  { name: "Windows (WINE)", alias: "windows", category: "port" },
  { name: "Windows Installers", alias: "windows_installers", category: "port" },
  { name: "Flatpak", alias: "flatpak", category: "port" },
  { name: "Steam", alias: "steam", category: "port" },
  { name: "Ports", alias: "ports", category: "port" },
  { name: "Flash (Flashpoint)", alias: "flash", category: "port" },
  { name: "Moonlight", alias: "moonlight", category: "port" },
  { name: "VGM Play", alias: "vgmplay", category: "port" },
  { name: "Abuse", alias: "abuse", category: "port" },
  { name: "BennuGD", alias: "bennugd", category: "port" },
  { name: "Blake Stone", alias: "bstone", category: "port" },
  { name: "Cannonball (OutRun)", alias: "cannonball", category: "port" },
  { name: "CatacombGL", alias: "catacomb", category: "port" },
  { name: "Cave Story (NXEngine)", alias: "cavestory", category: "port" },
  { name: "C-Dogs SDL", alias: "cdogs", category: "port" },
  { name: "Commander Genius", alias: "cgenius", category: "port" },
  { name: "CorsixTH (Theme Hospital)", alias: "corsixth", category: "port" },
  { name: "DevilutionX (Diablo)", alias: "devilutionx", category: "port" },
  { name: "Doom 3 BFG", alias: "doom3", category: "port" },
  { name: "DXX-Rebirth (Descent)", alias: "dxx-rebirth", category: "port" },
  { name: "EasyRPG", alias: "easyrpg", category: "port" },
  { name: "ECWolf", alias: "ecwolf", category: "port" },
  { name: "EDuke32 (Duke Nukem 3D)", alias: "eduke32", category: "port" },
  { name: "ET: Legacy", alias: "etlegacy", category: "port" },
  { name: "Fallout CE", alias: "fallout1-ce", category: "port" },
  { name: "Fallout 2 CE", alias: "fallout2-ce", category: "port" },
  { name: "Ion Fury", alias: "fury", category: "port" },
  { name: "GZDoom", alias: "gzdoom", category: "port" },
  { name: "Half-Life (Xash3D)", alias: "halflife", category: "port" },
  { name: "Hydra Castle Labyrinth", alias: "hcl", category: "port" },
  { name: "Hurrican", alias: "hurrican", category: "port" },
  { name: "Ikemen GO", alias: "ikemen", category: "port" },
  { name: "Return to Castle Wolfenstein (ioRTCW)", alias: "iortcw", category: "port" },
  { name: "Jazz Jackrabbit 2", alias: "jazz2", category: "port" },
  { name: "Jedi Knight: Dark Forces II (OpenJKDF2)", alias: "jkdf2", category: "port" },
  { name: "Star Wars: Jedi Academy (OpenJK)", alias: "jknight", category: "port" },
  { name: "Lutro", alias: "lutro", category: "port" },
  { name: "Medal of Honor: Allied Assault", alias: "mohaa", category: "port" },
  { name: "Mr. Boom", alias: "mrboom", category: "port" },
  { name: "M.U.G.E.N", alias: "mugen", category: "port" },
  { name: "OpenBOR", alias: "openbor", category: "port" },
  { name: "OpenJazz", alias: "openjazz", category: "port" },
  { name: "PrBoom", alias: "prboom", category: "port" },
  { name: "Pygame", alias: "pygame", category: "port" },
  { name: "Quake", alias: "quake", category: "port" },
  { name: "Quake II", alias: "quake2", category: "port" },
  { name: "Quake III Arena", alias: "quake3", category: "port" },
  { name: "Raze", alias: "raze", category: "port" },
  { name: "REminiscence (Flashback)", alias: "reminiscence", category: "port" },
  { name: "Rise of the Triad", alias: "rott", category: "port" },
  { name: "Return to Castle Wolfenstein", alias: "rtcw", category: "port" },
  { name: "ScummVM", alias: "scummvm", category: "port" },
  { name: "SDLPoP (Prince of Persia)", alias: "sdlpop", category: "port" },
  { name: "Solarus", alias: "solarus", category: "port" },
  { name: "Sonic Mania", alias: "sonic-mania", category: "port" },
  { name: "Sonic 3 A.I.R.", alias: "sonic3-air", category: "port" },
  { name: "Sonic Retro (Sonic 1/2/CD)", alias: "sonicretro", category: "port" },
  { name: "Super Mario War", alias: "superbroswar", category: "port" },
  { name: "The Force Engine", alias: "theforceengine", category: "port" },
  { name: "TheXTech (Super Mario Bros. X)", alias: "thextech", category: "port" },
  { name: "Tomb Raider (TR1X)", alias: "traider1", category: "port" },
  { name: "Tomb Raider II (TR2X)", alias: "traider2", category: "port" },
  { name: "OpenTyrian", alias: "tyrian", category: "port" },
  { name: "Visual Pinball X", alias: "vpinball", category: "port" },
  { name: "XRick (Rick Dangerous)", alias: "xrick", category: "port" },
  { name: "Zelda Classic", alias: "zc210", category: "port" },
];

/** Look up a canonical console by its Batocera alias/folder name. */
export const CONSOLE_BY_ALIAS: ReadonlyMap<string, Console> = new Map(
  CONSOLES.map((console) => [console.alias, console]),
);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test packages/core/test/consoles.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Type-check core**

Run: `pnpm --filter @praser/roomba-core build`
Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/consoles.ts packages/core/test/consoles.test.ts
git commit -m "feat(core)!: rebuild console catalog from Batocera systems + add category

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Core — `RoomSource.consoleFor` + `ENGINE_API_VERSION` = 2

**Files:**
- Modify: `packages/core/src/index.ts` (add method to `RoomSource`, bump `ENGINE_API_VERSION`)
- Modify: `packages/core/package.json` (version → `2.0.0`)
- Test: `packages/core/test/engine.test.ts`

**Interfaces:**
- Consumes: `Awaitable<T>` (already exported from `index.ts`).
- Produces: `RoomSource.consoleFor(url: URL): Awaitable<string | null>`; `ENGINE_API_VERSION = 2`.

- [ ] **Step 1: Update the engine-contract test**

Replace the body of `packages/core/test/engine.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  ENGINE_API_VERSION,
  type EngineContext,
  type RoomEngine,
  type RoomSource,
} from "../src/index.js";

describe("engine contract", () => {
  it("ENGINE_API_VERSION is 2", () => {
    expect(ENGINE_API_VERSION).toBe(2);
  });

  it("a conforming RoomEngine constructs a RoomSource with consoleFor", () => {
    const source: RoomSource = {
      id: "sample",
      baseURL: new URL("https://example.com"),
      loadConsoles: async () => [],
      resolve: (alias) => new URL(`/${alias}`, "https://example.com"),
      search: async () => [],
      downloadRequest: () => null,
      consoleFor: (url) => (url.searchParams.get("mediaId") ? "snes" : null),
    };

    const engine: RoomEngine = {
      id: "sample",
      name: "Sample",
      apiVersion: ENGINE_API_VERSION,
      version: "1.0.0",
      create: (_ctx: EngineContext) => source,
    };

    const created = engine.create({
      fetcher: async () => ({ status: 200, ok: true, body: "" }),
    });

    expect(created.consoleFor(new URL("https://example.com/?mediaId=1"))).toBe("snes");
    expect(created.consoleFor(new URL("https://example.com/"))).toBeNull();
    expect(engine.apiVersion).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/core/test/engine.test.ts`
Expected: FAIL — `ENGINE_API_VERSION` is 1 and `consoleFor` is not on `RoomSource`.

- [ ] **Step 3: Add `consoleFor` to `RoomSource`**

In `packages/core/src/index.ts`, inside the `RoomSource` interface, add this method right after `downloadRequest`:

```ts
  /**
   * If this source recognizes the URL, return the catalog alias of the console
   * it belongs to (e.g. "snes"); otherwise null. May be async: an engine can
   * navigate intermediate pages (via its injected Fetcher) to determine it.
   */
  consoleFor: (url: URL) => Awaitable<string | null>;
```

- [ ] **Step 4: Bump `ENGINE_API_VERSION`**

In `packages/core/src/index.ts`, change:

```ts
export const ENGINE_API_VERSION = 1;
```

to:

```ts
export const ENGINE_API_VERSION = 2;
```

- [ ] **Step 5: Bump the core package version**

In `packages/core/package.json`, change `"version": "1.4.0"` to `"version": "2.0.0"`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test packages/core/test/engine.test.ts`
Expected: PASS.

- [ ] **Step 7: Type-check core**

Run: `pnpm --filter @praser/roomba-core build`
Expected: no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/index.ts packages/core/package.json packages/core/test/engine.test.ts
git commit -m "feat(core)!: add RoomSource.consoleFor and bump ENGINE_API_VERSION to 2

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: CLI — `batocera.ts` (detect / roms dir / refresh)

**Files:**
- Create: `apps/cli/src/batocera.ts`
- Test: `apps/cli/test/batocera.test.ts`

**Interfaces:**
- Produces:
  - `interface DetectDeps { osReleasePath?: string; romsPath?: string }`
  - `detectBatocera(deps?: DetectDeps): boolean`
  - `romsDir(alias: string): string` → `/userdata/roms/<alias>`
  - `refreshLibrary(): Promise<void>` (best-effort; never throws)

- [ ] **Step 1: Write the failing tests**

Create `apps/cli/test/batocera.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectBatocera, romsDir } from "../src/batocera.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "roomba-bato-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("romsDir", () => {
  it("joins the alias under /userdata/roms", () => {
    expect(romsDir("snes")).toBe("/userdata/roms/snes");
    expect(romsDir("msx2+")).toBe("/userdata/roms/msx2+");
  });
});

describe("detectBatocera", () => {
  it("is true only when os-release names batocera AND the roms path exists", async () => {
    const osRelease = join(dir, "os-release");
    const roms = join(dir, "roms");
    await writeFile(osRelease, 'NAME="batocera"\nID=batocera\n');
    await rm(roms, { recursive: true, force: true });
    // os-release matches but roms path missing → false
    expect(detectBatocera({ osReleasePath: osRelease, romsPath: roms })).toBe(false);
  });

  it("is true when both signals are present", async () => {
    const osRelease = join(dir, "os-release");
    await writeFile(osRelease, 'PRETTY_NAME="Batocera 40"\nID=batocera\n');
    expect(detectBatocera({ osReleasePath: osRelease, romsPath: dir })).toBe(true);
  });

  it("is false when os-release does not mention batocera", async () => {
    const osRelease = join(dir, "os-release");
    await writeFile(osRelease, 'NAME="Ubuntu"\nID=ubuntu\n');
    expect(detectBatocera({ osReleasePath: osRelease, romsPath: dir })).toBe(false);
  });

  it("is false when os-release is missing", () => {
    expect(detectBatocera({ osReleasePath: join(dir, "nope"), romsPath: dir })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test apps/cli/test/batocera.test.ts`
Expected: FAIL — `../src/batocera.js` cannot be resolved.

- [ ] **Step 3: Implement `batocera.ts`**

Create `apps/cli/src/batocera.ts`:

```ts
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Paths detection reads; overridable so tests point at fixtures. */
export interface DetectDeps {
  /** os-release file (default "/etc/os-release"). */
  osReleasePath?: string;
  /** ROM root that must exist (default "/userdata/roms"). */
  romsPath?: string;
}

/**
 * True when running on a Batocera system: os-release mentions "batocera"
 * (case-insensitive) AND the ROM root exists. Requiring both avoids false
 * positives on a dev box that merely has an /userdata directory.
 */
export function detectBatocera(deps: DetectDeps = {}): boolean {
  const osReleasePath = deps.osReleasePath ?? "/etc/os-release";
  const romsPath = deps.romsPath ?? "/userdata/roms";
  let osRelease: string;
  try {
    osRelease = readFileSync(osReleasePath, "utf8");
  } catch {
    return false;
  }
  return /batocera/i.test(osRelease) && existsSync(romsPath);
}

/** Absolute ROM folder for a catalog alias: /userdata/roms/<alias>. */
export function romsDir(alias: string): string {
  return join("/userdata/roms", alias);
}

/**
 * Best-effort library refresh so a newly-placed ROM appears without a reboot.
 * Restarts EmulationStation via batocera-es-swissknife. Never throws: if the
 * binary is missing or exits non-zero, warn and return — the ROM is in place.
 */
export function refreshLibrary(): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn("batocera-es-swissknife", ["--restart"], { stdio: "ignore" });
    child.on("error", () => {
      process.stderr.write("roomba: could not refresh EmulationStation (restart it to see the game)\n");
      resolve();
    });
    child.on("close", () => resolve());
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test apps/cli/test/batocera.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/batocera.ts apps/cli/test/batocera.test.ts
git commit -m "feat(cli): add batocera detection, roms dir, and library refresh

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: CLI — download destination resolver + transfer speed

**Files:**
- Modify: `apps/cli/src/download.ts`
- Test: `apps/cli/test/download.test.ts`

**Interfaces:**
- Consumes: `CONSOLE_BY_ALIAS` from `@praser/roomba-core`; `formatBytes` (existing, in `download.ts`).
- Produces (new exports from `download.ts`):
  - `type Destination = { kind: "path"; output?: string } | { kind: "roms"; alias: string }`
  - `interface DestinationInput { output?: string; onBatocera: boolean; alias: string | null }`
  - `resolveDestination(input: DestinationInput): Destination` (throws on unknown/undetermined console)
  - `speedLabel(deltaBytes: number, deltaMs: number): string`
- Note: this task adds the pure helpers and wires `speedLabel` into `progressReporter`. Task 5 changes `downloadFile`'s signature and calls `resolveDestination`.

- [ ] **Step 1: Write the failing tests**

First, extend the existing import from `../src/download.js` at the top of
`apps/cli/test/download.test.ts` to also pull in the new helpers — add
`resolveDestination` and `speedLabel` to that import's braces (do **not** add a
second `vitest` import; `describe/expect/it` are already imported). Then append
these blocks:

```ts
describe("speedLabel", () => {
  it("formats bytes/elapsed as a per-second rate", () => {
    expect(speedLabel(1024 * 1024, 1000)).toBe("1.0 MB/s");
    expect(speedLabel(2 * 1024 * 1024, 500)).toBe("4.0 MB/s");
  });

  it("returns an empty string when no time has elapsed", () => {
    expect(speedLabel(1024, 0)).toBe("");
  });
});

describe("resolveDestination", () => {
  it("uses -o output wherever it is given (even on Batocera)", () => {
    expect(resolveDestination({ output: "/tmp/x.7z", onBatocera: true, alias: "snes" })).toEqual({
      kind: "path",
      output: "/tmp/x.7z",
    });
  });

  it("falls back to the default path off Batocera", () => {
    expect(resolveDestination({ onBatocera: false, alias: null })).toEqual({ kind: "path" });
  });

  it("targets the roms folder on Batocera when the alias is known", () => {
    expect(resolveDestination({ onBatocera: true, alias: "snes" })).toEqual({
      kind: "roms",
      alias: "snes",
    });
  });

  it("throws on Batocera when the console could not be determined", () => {
    expect(() => resolveDestination({ onBatocera: true, alias: null })).toThrow(
      /Couldn't determine the console/,
    );
  });

  it("throws on Batocera when the alias is not in the catalog", () => {
    expect(() => resolveDestination({ onBatocera: true, alias: "bogus" })).toThrow(
      /Unknown console 'bogus'/,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test apps/cli/test/download.test.ts`
Expected: FAIL — `resolveDestination` / `speedLabel` are not exported.

- [ ] **Step 3: Add `CONSOLE_BY_ALIAS` import and the pure helpers**

In `apps/cli/src/download.ts`, extend the core import (currently `import type { DownloadRequest, RoomSource } from "@praser/roomba-core";`) to also import the map value:

```ts
import { CONSOLE_BY_ALIAS } from "@praser/roomba-core";
import type { DownloadRequest, RoomSource } from "@praser/roomba-core";
```

Then add these exports near the other pure helpers (e.g. above `provisionalName`):

```ts
/** Where a download should be written. */
export type Destination =
  | { kind: "path"; output?: string } // default (~/Downloads) or -o path
  | { kind: "roms"; alias: string }; // /userdata/roms/<alias>

export interface DestinationInput {
  /** -o value, if given. */
  output?: string;
  onBatocera: boolean;
  /** Alias from --console or consoleFor, already resolved (null if unknown). */
  alias: string | null;
}

/** Decide where a download goes. Throws with guidance when placement is impossible. */
export function resolveDestination(input: DestinationInput): Destination {
  if (input.output != null) return { kind: "path", output: input.output };
  if (!input.onBatocera) return { kind: "path" };
  if (!input.alias) {
    throw new Error(
      "Couldn't determine the console for this URL — pass --console <alias> (see `roomba consoles`).",
    );
  }
  if (!CONSOLE_BY_ALIAS.has(input.alias)) {
    throw new Error(`Unknown console '${input.alias}' — see \`roomba consoles\`.`);
  }
  return { kind: "roms", alias: input.alias };
}

/** A short "N MB/s" label from bytes transferred over an elapsed interval. */
export function speedLabel(deltaBytes: number, deltaMs: number): string {
  if (deltaMs <= 0) return "";
  return `${formatBytes((deltaBytes / deltaMs) * 1000)}/s`;
}
```

- [ ] **Step 4: Wire speed into `progressReporter`**

Replace the existing `progressReporter` function in `apps/cli/src/download.ts` with:

```ts
/** A pass-through stream that prints download progress (and speed) to stderr. */
function progressReporter(total: number, start = 0): Transform {
  let downloaded = start;
  let lastPrint = 0;
  let lastBytes = start;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloaded += chunk.length;
      const now = Date.now();
      if (now - lastPrint > 200 || (total && downloaded >= total)) {
        const speed = speedLabel(downloaded - lastBytes, now - lastPrint);
        lastPrint = now;
        lastBytes = downloaded;
        const status = total
          ? `${formatBytes(downloaded)} / ${formatBytes(total)} (${((downloaded / total) * 100).toFixed(1)}%)`
          : formatBytes(downloaded);
        process.stderr.write(`\rDownloading… ${status}${speed ? ` ${speed}` : ""}`);
      }
      callback(null, chunk);
    },
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test apps/cli/test/download.test.ts`
Expected: PASS (existing tests + the new `speedLabel`/`resolveDestination` blocks).

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/download.ts apps/cli/test/download.test.ts
git commit -m "feat(cli): add destination resolver and transfer-speed readout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: CLI — Batocera-aware `downloadFile` (console resolution + placement + refresh)

**Files:**
- Modify: `apps/cli/src/download.ts` (`pickDownloadRequest`, `downloadFile`)
- Test: `apps/cli/test/download.test.ts`

**Interfaces:**
- Consumes: `resolveDestination`, `Destination` (Task 4); `detectBatocera`, `romsDir`, `refreshLibrary` (Task 3); `CONSOLE_BY_ALIAS` (core).
- Produces:
  - `resolveDownload(sources: RoomSource[], url: URL): Promise<{ source: RoomSource; request: DownloadRequest } | null>`
  - `interface DownloadOptions { output?: string; console?: string; noRefresh?: boolean }`
  - `downloadFile(sources: RoomSource[], rawUrl: string, options?: DownloadOptions): Promise<void>` (signature change: options object replaces the bare `output?` string)

- [ ] **Step 1: Write the failing test for `resolveDownload`**

Add to `apps/cli/test/download.test.ts`:

```ts
import type { RoomSource } from "@praser/roomba-core";
import { resolveDownload } from "../src/download.js";

function fakeSource(over: Partial<RoomSource>): RoomSource {
  return {
    id: "fake",
    baseURL: new URL("https://fake.test"),
    loadConsoles: async () => [],
    resolve: (a) => new URL(`/${a}`, "https://fake.test"),
    search: async () => [],
    downloadRequest: () => null,
    consoleFor: () => null,
    ...over,
  };
}

describe("resolveDownload", () => {
  it("returns the first source that recognizes the URL, with its request", async () => {
    const url = new URL("https://fake.test/?mediaId=5");
    const req = { url, headers: {} };
    const a = fakeSource({ downloadRequest: () => null });
    const b = fakeSource({ id: "b", downloadRequest: (u) => (u.href === url.href ? req : null) });
    const picked = await resolveDownload([a, b], url);
    expect(picked?.source.id).toBe("b");
    expect(picked?.request).toBe(req);
  });

  it("returns null when no source recognizes the URL", async () => {
    const picked = await resolveDownload([fakeSource({})], new URL("https://fake.test/x"));
    expect(picked).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test apps/cli/test/download.test.ts`
Expected: FAIL — `resolveDownload` is not exported.

- [ ] **Step 3: Replace `pickDownloadRequest` with `resolveDownload`**

In `apps/cli/src/download.ts`, replace the existing `pickDownloadRequest` function with:

```ts
/**
 * Ask each source whether it recognizes the URL; return the first that does,
 * paired with its resolved request. Awaited: an engine may navigate pages.
 */
export async function resolveDownload(
  sources: RoomSource[],
  url: URL,
): Promise<{ source: RoomSource; request: DownloadRequest } | null> {
  for (const source of sources) {
    const request = await source.downloadRequest(url);
    if (request) return { source, request };
  }
  return null;
}
```

- [ ] **Step 4: Add the Batocera imports to `download.ts`**

At the top of `apps/cli/src/download.ts`, add:

```ts
import { detectBatocera, refreshLibrary, romsDir } from "./batocera.js";
```

- [ ] **Step 5: Rewrite `downloadFile` to use the resolver, placement, and refresh**

Replace the existing `downloadFile` function (its signature and body, from `export async function downloadFile(` down to its closing brace) with:

```ts
export interface DownloadOptions {
  /** -o output file or directory. */
  output?: string;
  /** Force a console alias (overrides consoleFor). */
  console?: string;
  /** Skip the EmulationStation refresh after placing a ROM. */
  noRefresh?: boolean;
}

/**
 * Download a file, resuming a prior partial (`<dest>.part`) via an HTTP Range
 * request when one exists. On Batocera, places the ROM in /userdata/roms/<alias>
 * (alias from --console or the engine's consoleFor) and refreshes the library.
 * Ctrl-C pauses (the partial is kept); re-running resumes.
 */
export async function downloadFile(
  sources: RoomSource[],
  rawUrl: string,
  options: DownloadOptions = {},
): Promise<void> {
  const url = new URL(rawUrl);

  const resolved = await resolveDownload(sources, url);
  if (!resolved) {
    throw new Error(`No source knows how to download ${url.href}`);
  }
  const { source, request } = resolved;

  const onBatocera = detectBatocera();
  // Resolve the console: explicit flag wins; else ask the matching engine.
  // Only needed when we might place into a roms folder (Batocera, no -o).
  let alias: string | null = options.console ?? null;
  if (alias == null && onBatocera && options.output == null) {
    alias = await source.consoleFor(url);
  }

  const destination = resolveDestination({ output: options.output, onBatocera, alias });

  // Announce the detected console once, before streaming.
  if (destination.kind === "roms") {
    const known = CONSOLE_BY_ALIAS.get(destination.alias);
    console.log(`Console: ${destination.alias}${known ? ` (${known.name})` : ""}`);
  }

  const { dir, fixedFile } =
    destination.kind === "roms"
      ? await ensureDir(romsDir(destination.alias))
      : await targetDir(destination.output);

  const provisional = provisionalName(url);
  const partialPath = fixedFile ? `${fixedFile}.part` : join(dir, `${provisional}.part`);
  const existing = await fileSize(partialPath);

  const headers = { ...request.headers };
  if (existing > 0) headers.Range = `bytes=${existing}-`;

  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  process.once("SIGINT", onSigint);

  try {
    const response = await fetch(request.url, { headers, signal: controller.signal });

    const plan = resumePlan(existing, response.status, {
      contentLength: Number(response.headers.get("content-length")) || 0,
      contentRange: response.headers.get("content-range"),
    });

    const finalDest = fixedFile
      ? fixedFile
      : join(
          dir,
          resolveFinalName(
            response.headers.get("content-disposition"),
            new URL(response.url),
            provisional,
          ),
        );

    if (plan.action === "complete") {
      await rename(partialPath, finalDest);
      console.log(`Saved to ${finalDest}`);
      await maybeRefresh(destination, options.noRefresh);
      return;
    }

    if (!response.ok || !response.body) {
      throw new Error(
        `Download failed: ${response.status} ${response.statusText} for ${url.href}`,
      );
    }

    if (plan.action === "append") {
      process.stderr.write(`Resuming from ${formatBytes(plan.start)}…\n`);
    }

    await pipeline(
      Readable.fromWeb(response.body),
      progressReporter(plan.total, plan.start),
      createWriteStream(partialPath, { flags: plan.action === "append" ? "a" : "w" }),
    );

    await rename(partialPath, finalDest);
    process.stderr.write("\n");
    console.log(`Saved to ${finalDest}`);
    await maybeRefresh(destination, options.noRefresh);
  } catch (error) {
    if (controller.signal.aborted) {
      process.stderr.write("\n");
      console.log("Paused — re-run the same command to resume.");
      process.exitCode = 130;
      return;
    }
    throw error;
  } finally {
    process.off("SIGINT", onSigint);
  }
}

/** Refresh EmulationStation after a ROM placement, unless suppressed. */
async function maybeRefresh(destination: Destination, noRefresh?: boolean): Promise<void> {
  if (destination.kind === "roms" && !noRefresh) await refreshLibrary();
}

/** mkdir -p a known directory and return it in targetDir's shape. */
async function ensureDir(dir: string): Promise<{ dir: string; fixedFile?: string }> {
  await mkdir(dir, { recursive: true });
  return { dir };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test apps/cli/test/download.test.ts`
Expected: PASS.

- [ ] **Step 7: Type-check the CLI (expect one error in index.ts)**

Run: `pnpm --filter @praser/roomba build`
Expected: FAIL — `index.ts` still calls `downloadFile(sources, url, options.output)` with the old signature. Task 6 fixes this.

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/download.ts apps/cli/test/download.test.ts
git commit -m "feat(cli): place ROMs into Batocera folders and refresh after download

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: CLI — wire `--console` / `--no-refresh` into the `download` command

**Files:**
- Modify: `apps/cli/src/index.ts` (the `download` command action)
- Modify: `apps/cli/README.md` and `README.md` (document the flags)

**Interfaces:**
- Consumes: `downloadFile(sources, url, { output, console, noRefresh })` (Task 5).

- [ ] **Step 1: Update the `download` command definition**

In `apps/cli/src/index.ts`, replace the whole `download` command block (from `program\n  .command("download")` through the end of its `.action(...)`) with:

```ts
program
  .command("download")
  .argument("<url>", "download URL from `roomba search`")
  .option(
    "-o, --output <path>",
    "output file or directory (default: your Downloads folder; on Batocera, the system's ROM folder)",
  )
  .option(
    "-c, --console <alias>",
    "force the console (see `roomba consoles`); overrides auto-detection",
  )
  .option("--no-refresh", "on Batocera, don't restart EmulationStation after download")
  .description("Download a game file")
  .action(
    async (url: string, options: { output?: string; console?: string; refresh: boolean }) => {
      const sources = await createSources({ cache: false });
      if (sources.length === 0) return printNoEngines();
      await downloadFile(sources, url, {
        output: options.output,
        console: options.console,
        noRefresh: !options.refresh,
      });
    },
  );
```

Note: commander maps `--no-refresh` to `options.refresh === false`; we translate that to `noRefresh`.

- [ ] **Step 2: Type-check and run the whole suite**

Run: `pnpm --filter @praser/roomba build && pnpm test`
Expected: build succeeds; all tests PASS.

- [ ] **Step 3: Smoke-test the CLI wiring (off Batocera)**

Run: `pnpm build && node apps/cli/dist/index.js download --help`
Expected: help lists `-o, --output`, `-c, --console <alias>`, and `--no-refresh`.

- [ ] **Step 4: Update the docs**

In `README.md`, update the `download` row of the commands table to:

```
| `roomba download <url> [-o <path>] [-c <alias>] [--no-refresh]` | Download a game file (on Batocera, into the system's ROM folder) |
```

In `apps/cli/README.md`, add to the `download` section a short note (place it wherever `download` flags are described):

```
On Batocera, `download` detects the system and saves into
`/userdata/roms/<system>/`, then restarts EmulationStation so the game appears
and is playable. The system is resolved from the URL by the engine; pass
`-c, --console <alias>` to force it (see `roomba consoles`), or `--no-refresh`
to skip the EmulationStation restart. `-o` overrides placement everywhere. The
progress line shows live transfer speed. Files are saved as downloaded
(`.7z`/`.zip`); systems that need `.chd`/`.pbp` will appear but not yet launch.
```

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/index.ts README.md apps/cli/README.md
git commit -m "feat(cli): add --console and --no-refresh to download; document Batocera flow

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Rollout (post-implementation, not a code task)

1. Release `@praser/roomba-core` `2.0.0` (breaking: `ENGINE_API_VERSION` 2 + `Console.category`) and the CLI via the roomba release pipeline.
2. Update engines to API v2: implement `consoleFor`, remap internal ids onto Batocera aliases, rebuild, republish. `roomba-vimm` is the reference engine and an out-of-tree dependency of this work.
3. Users reinstall engines (`roomba engine install <url>`); v1 engines are refused with a clear message until updated.

## Self-Review Notes

- **Spec coverage:** catalog rebuild + category (Task 1); `consoleFor` + API v2 (Task 2); detect/romsDir/refresh (Task 3); destination matrix + bandwidth (Task 4); placement + refresh + console line (Task 5); `--console`/`--no-refresh` + docs (Task 6). Rollout mirrors the spec.
- **Deferred (not in this plan):** ScreenScraper metadata (v2) and format/archive conversion (v3), per the spec.
- **Type consistency:** `downloadFile(sources, url, DownloadOptions)` is defined in Task 5 and consumed in Task 6; `resolveDestination`/`Destination`/`speedLabel` defined in Task 4 and consumed in Task 5; `detectBatocera`/`romsDir`/`refreshLibrary` defined in Task 3 and consumed in Task 5.
- **Catalog membership caveat:** the literal in Task 1 is built from the Batocera systems wiki (names + categories) reconciled against the ROM-folder list. If, while implementing, you find a `/userdata/roms` folder not present in the literal, add it with `name = alias` and `category = "port"` (the documented fallback); drop any wiki-only entry that has no folder.
