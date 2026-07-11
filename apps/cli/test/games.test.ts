import type { Console, GameFile, RoomSource } from "@roomba/core";
import { describe, expect, it, vi } from "vitest";
import { searchGames } from "../src/games.js";

function game(overrides: Partial<GameFile> = {}): GameFile {
  return {
    name: "Game",
    region: "USA",
    version: "1.0",
    languages: "en",
    rating: "8.0",
    size: "1 MB",
    downloadUrl: "https://dl3.vimm.net/?mediaId=1",
    ...overrides,
  };
}

function fakeSource(consoles: Console[], games: GameFile[]): RoomSource {
  return {
    id: "fake",
    baseURL: new URL("https://example.com"),
    loadConsoles: vi.fn(async () => consoles),
    resolve: (alias) => new URL(`https://example.com/${alias}`),
    search: vi.fn(async () => games),
    downloadRequest: () => null,
  };
}

const SNES: Console = { name: "Super Nintendo", alias: "SNES" };

describe("searchGames", () => {
  it("matches the alias case-insensitively and calls search with the canonical alias", async () => {
    const source = fakeSource([SNES], [game()]);

    const rows = await searchGames([source], "snes", "mario");

    expect(source.search).toHaveBeenCalledWith("SNES", "mario");
    expect(rows).toHaveLength(1);
  });

  it("throws for an unknown console", async () => {
    const source = fakeSource([SNES], [game()]);

    await expect(searchGames([source], "n64", "mario")).rejects.toThrow(/Unknown console "n64"/);
  });

  it("filters by region case-insensitively (substring match)", async () => {
    const source = fakeSource(
      [SNES],
      [game({ region: "USA" }), game({ region: "Europe" }), game({ region: "USA, Canada" })],
    );

    const rows = await searchGames([source], "SNES", "q", { region: "usa" });

    expect(rows.map((r) => r.region)).toEqual(["USA", "USA, Canada"]);
  });

  it("filters by language code", async () => {
    const source = fakeSource(
      [SNES],
      [game({ languages: "de en fr" }), game({ languages: "-" }), game({ languages: "ja" })],
    );

    const rows = await searchGames([source], "SNES", "q", { language: "EN" });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.languages).toBe("de en fr");
  });
});
