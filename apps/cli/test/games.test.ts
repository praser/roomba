import type { Console, GameFile, RoomSource } from "@praser/roomba-core";
import { describe, expect, it, vi } from "vitest";
import { searchGames } from "../src/games.js";

function game(overrides: Partial<GameFile> = {}): GameFile {
  return {
    name: "Game",
    region: "USA",
    version: "1.0",
    size: "1 MB",
    downloadUrl: "https://dl3.vimm.net/?mediaId=1",
    ...overrides,
  };
}

function fakeSource(id: string, consoles: Console[], games: GameFile[]): RoomSource {
  return {
    id,
    baseURL: new URL("https://example.com"),
    loadConsoles: vi.fn(async () => consoles),
    resolve: (alias) => new URL(`https://example.com/${alias}`),
    search: vi.fn(async () => games),
    downloadRequest: () => null,
  };
}

const SNES: Console = { name: "Super Nintendo", alias: "snes" };

describe("searchGames", () => {
  it("matches the alias case-insensitively and tags results with the source id", async () => {
    const source = fakeSource("vimm", [SNES], [game()]);

    const rows = await searchGames([source], "SNES", "mario");

    expect(source.search).toHaveBeenCalledWith("snes", "mario");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("vimm");
  });

  it("merges results from multiple sources, each tagged with its source", async () => {
    const vimm = fakeSource("vimm", [SNES], [game({ name: "A" })]);
    const emu = fakeSource("emuparadise", [SNES], [game({ name: "B" })]);

    const rows = await searchGames([vimm, emu], "snes", "q");

    expect(rows.map((r) => [r.name, r.source])).toEqual([
      ["A", "vimm"],
      ["B", "emuparadise"],
    ]);
  });

  it("throws for an unknown console", async () => {
    const source = fakeSource("vimm", [SNES], [game()]);

    await expect(searchGames([source], "n64", "mario")).rejects.toThrow(/Unknown console "n64"/);
  });

  it("filters by region case-insensitively (substring match)", async () => {
    const source = fakeSource(
      "vimm",
      [SNES],
      [game({ region: "USA" }), game({ region: "Europe" }), game({ region: "USA, Canada" })],
    );

    const rows = await searchGames([source], "snes", "q", { region: "usa" });

    expect(rows.map((r) => r.region)).toEqual(["USA", "USA, Canada"]);
  });
});
