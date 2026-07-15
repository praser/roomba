import { describe, expect, it } from "vitest";
import { CONSOLES } from "../src/consoles.js";
import { acceptedExtensions, SYSTEM_EXTENSIONS } from "../src/extensions.js";

// Aliases intentionally without an accepted-extensions entry (no authoritative
// _info.txt data on hand). Runtime treats these as "keep" (never extract).
const UNMAPPED_ALIASES = new Set(["iortcw"]);

describe("SYSTEM_EXTENSIONS catalog", () => {
  it("returns a known system's accepted extensions, lowercase without dots", () => {
    expect(acceptedExtensions("psx")).toEqual([
      "cue",
      "img",
      "mdf",
      "pbp",
      "toc",
      "cbn",
      "m3u",
      "ccd",
      "chd",
      "iso",
    ]);
  });

  it("returns an empty array for an unknown alias", () => {
    expect(acceptedExtensions("not-a-real-system")).toEqual([]);
  });

  it("has no orphan keys — every mapped alias is a real console", () => {
    const aliases = new Set(CONSOLES.map((c) => c.alias));
    const orphans = Object.keys(SYSTEM_EXTENSIONS).filter((a) => !aliases.has(a));
    expect(orphans).toEqual([]);
  });

  it("covers every catalog alias except the documented unmapped set", () => {
    const missing = CONSOLES.map((c) => c.alias).filter(
      (a) => !(a in SYSTEM_EXTENSIONS) && !UNMAPPED_ALIASES.has(a),
    );
    expect(missing).toEqual([]);
  });
});
