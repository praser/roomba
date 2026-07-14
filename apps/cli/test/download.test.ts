import { describe, expect, it } from "vitest";
import {
  formatBytes,
  parseContentDispositionFilename,
  provisionalName,
  resolveDestination,
  resolveFinalName,
  resumePlan,
  speedLabel,
} from "../src/download.js";

describe("parseContentDispositionFilename", () => {
  it("reads a quoted filename", () => {
    expect(
      parseContentDispositionFilename('attachment; filename="Resident Evil 2 (Europe).7z"'),
    ).toBe("Resident Evil 2 (Europe).7z");
  });

  it("reads an RFC 5987 filename*", () => {
    expect(parseContentDispositionFilename("attachment; filename*=UTF-8''Pok%C3%A9mon.gba")).toBe(
      "Pokémon.gba",
    );
  });

  it("strips directory components", () => {
    expect(parseContentDispositionFilename('attachment; filename="../../etc/passwd"')).toBe(
      "passwd",
    );
  });

  it("returns null when there is no header", () => {
    expect(parseContentDispositionFilename(null)).toBeNull();
  });
});

describe("provisionalName", () => {
  it("uses the Vimm mediaId", () => {
    expect(provisionalName(new URL("https://dl3.vimm.net/?mediaId=44190"))).toBe("44190.7z");
  });

  it("falls back to the URL basename", () => {
    expect(provisionalName(new URL("https://www.emuparadise.me/PSX_ISOs/Game/37713"))).toBe(
      "37713",
    );
  });
});

describe("resolveFinalName", () => {
  it("prefers the Content-Disposition filename", () => {
    const name = resolveFinalName(
      'attachment; filename="Nice Name.7z"',
      new URL("https://cdn.example.com/x/whatever.7z"),
      "37713",
    );
    expect(name).toBe("Nice Name.7z");
  });

  it("falls back to the decoded final-URL basename when it has an extension", () => {
    const name = resolveFinalName(
      null,
      new URL("https://dl1.mprd.se/abc/Tomb%20Raider%20II%20%28USA%29%20%28v1.3%29.7z"),
      "37713",
    );
    expect(name).toBe("Tomb Raider II (USA) (v1.3).7z");
  });

  it("falls back to the provisional name when nothing better exists", () => {
    expect(resolveFinalName(null, new URL("https://x.com/download"), "37713")).toBe("37713");
  });
});

describe("resumePlan", () => {
  it("appends on 206, taking the total from Content-Range", () => {
    expect(resumePlan(100, 206, { contentLength: 340, contentRange: "bytes 100-439/440" })).toEqual(
      { action: "append", start: 100, total: 440 },
    );
  });

  it("restarts when the server ignores Range and sends 200", () => {
    expect(resumePlan(100, 200, { contentLength: 440, contentRange: null })).toEqual({
      action: "restart",
      start: 0,
      total: 440,
    });
  });

  it("treats 416 as already complete", () => {
    expect(resumePlan(440, 416, { contentLength: 0, contentRange: null })).toEqual({
      action: "complete",
      start: 440,
      total: 440,
    });
  });

  it("does a fresh download when there is no partial", () => {
    expect(resumePlan(0, 200, { contentLength: 440, contentRange: null })).toEqual({
      action: "restart",
      start: 0,
      total: 440,
    });
  });
});

describe("formatBytes", () => {
  it("formats across units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(3.5 * 1024 * 1024 * 1024)).toBe("3.5 GB");
  });
});

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
