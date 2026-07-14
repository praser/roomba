import { describe, expect, it } from "vitest";
import { normalizeSize } from "../src/index.js";

describe("normalizeSize", () => {
  it("normalizes unit-only sizes (Emuparadise style)", () => {
    expect(normalizeSize("441M")).toBe("441 MB");
    expect(normalizeSize("40K")).toBe("40 KB");
    expect(normalizeSize("1.3G")).toBe("1.3 GB");
  });

  it("keeps already-normalized sizes (Vimm style)", () => {
    expect(normalizeSize("330 MB")).toBe("330 MB");
    expect(normalizeSize("73.66 MB")).toBe("73.66 MB");
    expect(normalizeSize("0 KB")).toBe("0 KB");
  });

  it("is case-insensitive and tolerates spacing", () => {
    expect(normalizeSize("2.9g")).toBe("2.9 GB");
    expect(normalizeSize("  512 kb ")).toBe("512 KB");
  });

  it("treats a bare number as bytes", () => {
    expect(normalizeSize("1024")).toBe("1024 B");
  });

  it("returns unparseable input trimmed", () => {
    expect(normalizeSize("  unknown ")).toBe("unknown");
  });
});
