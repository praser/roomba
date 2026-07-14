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
