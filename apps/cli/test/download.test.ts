import { describe, expect, it } from "vitest";
import { filenameFromContentDisposition, formatBytes } from "../src/download.js";

const url = new URL("https://dl3.vimm.net/?mediaId=44190");

describe("filenameFromContentDisposition", () => {
  it("reads a quoted filename", () => {
    expect(
      filenameFromContentDisposition('attachment; filename="Resident Evil 2 (Europe).7z"', url),
    ).toBe("Resident Evil 2 (Europe).7z");
  });

  it("reads an RFC 5987 filename*", () => {
    expect(
      filenameFromContentDisposition("attachment; filename*=UTF-8''Pok%C3%A9mon.gba", url),
    ).toBe("Pokémon.gba");
  });

  it("strips any directory components from the header value", () => {
    expect(filenameFromContentDisposition('attachment; filename="../../etc/passwd"', url)).toBe(
      "passwd",
    );
  });

  it("falls back to the mediaId when no header is present", () => {
    expect(filenameFromContentDisposition(null, url)).toBe("44190.7z");
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
