import { describe, expect, it } from "vitest";
import { CONSOLE_BY_ALIAS, CONSOLES } from "../src/index.js";

describe("console catalog", () => {
  it("uses unique, slug-formatted aliases", () => {
    const aliases = CONSOLES.map((c) => c.alias);
    expect(new Set(aliases).size).toBe(aliases.length); // no duplicates
    for (const alias of aliases) {
      expect(alias).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/); // lowercase slug
    }
  });

  it("has a non-empty name for every entry", () => {
    for (const console of CONSOLES) expect(console.name.length).toBeGreaterThan(0);
  });

  it("CONSOLE_BY_ALIAS resolves each alias to its entry", () => {
    expect(CONSOLE_BY_ALIAS.size).toBe(CONSOLES.length);
    expect(CONSOLE_BY_ALIAS.get("gba")).toEqual({ name: "Game Boy Advance", alias: "gba" });
    expect(CONSOLE_BY_ALIAS.get("n64")?.name).toBe("Nintendo 64");
    expect(CONSOLE_BY_ALIAS.get("nope")).toBeUndefined();
  });
});
