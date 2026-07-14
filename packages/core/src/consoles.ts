import type { Console } from "./index.js";

/**
 * The canonical catalog of consoles roomba knows about. Engines map their own
 * internal system ids onto these `alias` slugs so the same physical console
 * unifies across sources. Core deliberately knows more consoles than any single
 * engine; `roomba consoles` only shows the ones an installed engine maps.
 *
 * `alias` is a short, lowercase, stable slug. `name` is the canonical display
 * name (the single source of truth, so every engine renders it identically).
 */
export const CONSOLES: readonly Console[] = [
  // --- Nintendo ---
  { name: "Nintendo Entertainment System", alias: "nes" },
  { name: "Famicom Disk System", alias: "fds" },
  { name: "Super Nintendo", alias: "snes" },
  { name: "Nintendo 64", alias: "n64" },
  { name: "Nintendo 64DD", alias: "n64dd" },
  { name: "Nintendo GameCube", alias: "gamecube" },
  { name: "Nintendo Wii", alias: "wii" },
  { name: "Wii (WiiWare)", alias: "wiiware" },
  { name: "Nintendo 3DS", alias: "3ds" },
  { name: "Nintendo DS", alias: "ds" },
  { name: "Game Boy", alias: "gb" },
  { name: "Game Boy Color", alias: "gbc" },
  { name: "Game Boy Advance", alias: "gba" },
  { name: "Virtual Boy", alias: "virtual-boy" },
  { name: "Nintendo Pokémon Mini", alias: "pokemon-mini" },
  { name: "Nintendo Game & Watch", alias: "game-and-watch" },
  { name: "iQue Player", alias: "ique" },

  // --- Sony ---
  { name: "PlayStation", alias: "ps1" },
  { name: "PlayStation 2", alias: "ps2" },
  { name: "PlayStation 3", alias: "ps3" },
  { name: "PlayStation Portable", alias: "psp" },
  { name: "PSX on PSP", alias: "psx-on-psp" },

  // --- Microsoft ---
  { name: "Xbox", alias: "xbox" },
  { name: "Xbox 360", alias: "xbox-360" },
  { name: "Xbox 360 (Digital)", alias: "xbox-360-digital" },

  // --- Sega ---
  { name: "Sega Master System", alias: "sms" },
  { name: "Sega Genesis / Mega Drive", alias: "genesis" },
  { name: "Sega CD / Mega-CD", alias: "sega-cd" },
  { name: "Sega 32X", alias: "32x" },
  { name: "Sega Saturn", alias: "saturn" },
  { name: "Sega Dreamcast", alias: "dreamcast" },
  { name: "Sega Game Gear", alias: "gg" },
  { name: "Sega SG-1000", alias: "sg-1000" },
  { name: "Sega Pico", alias: "pico" },
  { name: "Sega NAOMI", alias: "naomi" },

  // --- Atari ---
  { name: "Atari 2600", alias: "atari-2600" },
  { name: "Atari 5200", alias: "atari-5200" },
  { name: "Atari 7800", alias: "atari-7800" },
  { name: "Atari Lynx", alias: "lynx" },
  { name: "Atari Jaguar", alias: "jaguar" },
  { name: "Atari Jaguar CD", alias: "jaguar-cd" },
  { name: "Atari 8-bit Family", alias: "atari-8-bit" },
  { name: "Atari ST", alias: "atari-st" },

  // --- NEC / Hudson ---
  { name: "TurboGrafx-16 / PC Engine", alias: "turbografx-16" },
  { name: "TurboGrafx-CD / PC Engine CD", alias: "turbografx-cd" },

  // --- SNK ---
  { name: "Neo Geo", alias: "neo-geo" },
  { name: "Neo Geo Pocket / Color", alias: "neo-geo-pocket" },

  // --- Arcade / Capcom ---
  { name: "MAME (Arcade)", alias: "mame" },
  { name: "Capcom Play System 1", alias: "cps1" },
  { name: "Capcom Play System 2", alias: "cps2" },
  { name: "Capcom Play System 3", alias: "cps3" },

  // --- Bandai ---
  { name: "Bandai WonderSwan / Color", alias: "wonderswan" },

  // --- Other consoles ---
  { name: "Panasonic 3DO", alias: "3do" },
  { name: "Philips CD-i", alias: "cd-i" },
  { name: "Magnavox Odyssey", alias: "odyssey" },
  { name: "ColecoVision", alias: "colecovision" },
  { name: "Coleco Adam", alias: "coleco-adam" },
  { name: "Bally Astrocade", alias: "astrocade" },
  { name: "Interton VC-4000", alias: "vc-4000" },
  { name: "Fujitsu FM Towns Marty", alias: "fm-towns-marty" },
  { name: "Nokia N-Gage", alias: "n-gage" },
  { name: "Tapwave Zodiac", alias: "zodiac" },
  { name: "Tiger Telematics Gizmondo", alias: "gizmondo" },
  { name: "GamePark 32", alias: "gp32" },
  { name: "Watara Supervision", alias: "supervision" },
  { name: "Epoch Super Cassette Vision", alias: "super-cassette-vision" },
  { name: "Timetop GameKing", alias: "game-king" },
  { name: "Bit Corporation Gamate", alias: "gamate" },
  { name: "Mega Duck / Cougar Boy", alias: "mega-duck" },
  { name: "Barcode Battler", alias: "barcode-battler" },
  { name: "Infinium Labs Phantom", alias: "phantom" },

  // --- Home computers ---
  { name: "Commodore Amiga", alias: "amiga" },
  { name: "Commodore 64", alias: "commodore-64" },
  { name: "Amstrad CPC", alias: "amstrad-cpc" },
  { name: "Sharp X68000", alias: "sharp-x68000" },
  { name: "ZX Spectrum", alias: "zx-spectrum" },
];

/** Look up a canonical console by its alias slug. */
export const CONSOLE_BY_ALIAS: ReadonlyMap<string, Console> = new Map(
  CONSOLES.map((console) => [console.alias, console]),
);
