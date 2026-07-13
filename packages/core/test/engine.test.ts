import { describe, expect, it } from "vitest";
import {
  ENGINE_API_VERSION,
  type EngineContext,
  type RoomEngine,
  type RoomSource,
} from "../src/index.js";

describe("engine contract", () => {
  it("ENGINE_API_VERSION is 1", () => {
    expect(ENGINE_API_VERSION).toBe(1);
  });

  it("a conforming RoomEngine constructs a RoomSource from a context", () => {
    const source: RoomSource = {
      id: "sample",
      baseURL: new URL("https://example.com"),
      loadConsoles: async () => [],
      resolve: (alias) => new URL(`/${alias}`, "https://example.com"),
      search: async () => [],
      downloadRequest: () => null,
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

    expect(created.id).toBe("sample");
    expect(engine.apiVersion).toBe(1);
  });
});
