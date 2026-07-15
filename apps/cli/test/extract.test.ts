import { describe, expect, it, vi } from "vitest";
import { extractArchive } from "../src/extract.js";

function deps(code: number) {
  const unlinked: string[] = [];
  const made: string[] = [];
  const run = vi.fn(async () => ({ code }));
  return {
    unlinked,
    made,
    run,
    opts: {
      run,
      unlink: async (p: string) => void unlinked.push(p),
      mkdir: async (p: string) => void made.push(p),
    },
  };
}

describe("extractArchive", () => {
  it("extracts into a subfolder named after the archive and deletes it on success", async () => {
    const d = deps(0);
    const result = await extractArchive("/userdata/roms/psx/Some Game.zip", d.opts);

    expect(result).toEqual({ ok: true, dir: "/userdata/roms/psx/Some Game" });
    expect(d.made).toEqual(["/userdata/roms/psx/Some Game"]);
    expect(d.run).toHaveBeenCalledWith("7z", [
      "x",
      "-o/userdata/roms/psx/Some Game",
      "-y",
      "/userdata/roms/psx/Some Game.zip",
    ]);
    expect(d.unlinked).toEqual(["/userdata/roms/psx/Some Game.zip"]);
  });

  it("keeps the archive and reports failure on a non-zero exit", async () => {
    const d = deps(2);
    const result = await extractArchive("/userdata/roms/psx/Broken.7z", d.opts);

    expect(result).toEqual({ ok: false, dir: "/userdata/roms/psx/Broken" });
    expect(d.unlinked).toEqual([]);
  });

  it("keeps the archive when the extractor is missing (code -1)", async () => {
    const d = deps(-1);
    const result = await extractArchive("/userdata/roms/psx/Game.rar", d.opts);

    expect(result.ok).toBe(false);
    expect(d.unlinked).toEqual([]);
  });
});
