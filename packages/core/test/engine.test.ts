import { describe, expect, it } from "vitest";
import {
  ENGINE_API_VERSION,
  type EngineContext,
  type RoomEngine,
  type RoomSource,
} from "../src/index.js";

describe("engine contract", () => {
  it("ENGINE_API_VERSION is 2", () => {
    expect(ENGINE_API_VERSION).toBe(2);
  });

  it("a conforming RoomEngine constructs a RoomSource with consoleFor", () => {
    const source: RoomSource = {
      id: "sample",
      baseURL: new URL("https://example.com"),
      loadConsoles: async () => [],
      resolve: (alias) => new URL(`/${alias}`, "https://example.com"),
      search: async () => [],
      downloadRequest: () => null,
      consoleFor: (url) => (url.searchParams.get("mediaId") ? "snes" : null),
    };

    const engine: RoomEngine = {
      id: "sample",
      name: "Sample",
      apiVersion: ENGINE_API_VERSION,
      version: "1.0.0",
      create: (_ctx: EngineContext) => source,
    };

    const created = engine.create({
      fetcher: async () => ({ status: 200, ok: true, body: "" }),
    });

    expect(created.consoleFor(new URL("https://example.com/?mediaId=1"))).toBe("snes");
    expect(created.consoleFor(new URL("https://example.com/"))).toBeNull();
    expect(engine.apiVersion).toBe(2);
  });
});
