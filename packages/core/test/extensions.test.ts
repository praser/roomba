import { describe, expect, it } from "vitest";
import { CONSOLES } from "../src/consoles.js";
import { acceptedExtensions, planPostDownload, SYSTEM_EXTENSIONS } from "../src/extensions.js";

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

describe("planPostDownload", () => {
  it("keeps an archive the system reads directly (cartridge)", () => {
    expect(planPostDownload("snes", "Game.zip")).toEqual({ kind: "keep" });
  });

  it("keeps an arcade romset zip — never extracts it", () => {
    expect(planPostDownload("mame", "sf2.zip")).toEqual({ kind: "keep" });
  });

  it("extracts an archive the system cannot read (disc)", () => {
    expect(planPostDownload("psx", "Some Game.zip")).toEqual({
      kind: "extract",
      archive: "Some Game.zip",
    });
  });

  it("extracts rar and 7z too", () => {
    expect(planPostDownload("psx", "Game.rar").kind).toBe("extract");
    expect(planPostDownload("psx", "Game.7z").kind).toBe("extract");
  });

  it("keeps a disc image the system already reads", () => {
    expect(planPostDownload("psx", "Game.chd")).toEqual({ kind: "keep" });
  });

  it("is case-insensitive on the extension", () => {
    expect(planPostDownload("psx", "GAME.ZIP").kind).toBe("extract");
  });

  it("flags a non-accepted, non-extractable file as manual", () => {
    expect(planPostDownload("psx", "Game.rev")).toEqual({ kind: "manual", ext: "rev" });
  });

  it("keeps files for an unknown alias (no data → never touch)", () => {
    expect(planPostDownload("not-a-real-system", "Game.zip")).toEqual({ kind: "keep" });
  });

  it("keeps a file with no extension", () => {
    expect(planPostDownload("psx", "README")).toEqual({ kind: "keep" });
  });
});
