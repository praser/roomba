import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineContext } from "@roomba/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultDownload,
  installEngine,
  loadEngines,
  readRegistry,
  removeEngine,
  validateEngine,
} from "../src/engines.js";

/** An ESM engine bundle as a source string, parameterized by apiVersion. */
function fixtureBundle(apiVersion = 1): string {
  return `export default {
  id: "fixture",
  name: "Fixture Source",
  apiVersion: ${apiVersion},
  version: "1.0.0",
  create: (ctx) => ({
    id: "fixture",
    baseURL: new URL("https://fixture.test"),
    loadConsoles: async () => [{ name: "Fixture Console", alias: "FIX" }],
    resolve: (alias) => new URL("/" + alias, "https://fixture.test"),
    search: async () => [],
    downloadRequest: () => null,
  }),
};
`;
}

const ctx: EngineContext = {
  fetcher: async () => ({ status: 200, ok: true, body: "" }),
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "roomba-engines-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readRegistry", () => {
  it("returns an empty list when registry.json is valid JSON but not an array", async () => {
    await writeFile(join(dir, "registry.json"), "{}");
    expect(await readRegistry(dir)).toEqual([]);
  });
});

describe("installEngine", () => {
  it("downloads, validates, writes the bundle and a registry entry", async () => {
    const entry = await installEngine("https://x.test/e.mjs", {
      dir,
      download: async () => fixtureBundle(),
      confirm: async () => true,
    });

    expect(entry).not.toBeNull();
    expect(entry!.id).toBe("fixture");
    expect(entry!.sourceUrl).toBe("https://x.test/e.mjs");

    const bundle = await readFile(join(dir, "fixture.mjs"), "utf8");
    expect(bundle).toContain("Fixture Source");

    const registry = await readRegistry(dir);
    expect(registry).toHaveLength(1);
    expect(registry[0]!.id).toBe("fixture");
  });

  it("returns null and installs nothing when confirmation is declined", async () => {
    const entry = await installEngine("https://x.test/e.mjs", {
      dir,
      download: async () => fixtureBundle(),
      confirm: async () => false,
    });

    expect(entry).toBeNull();
    expect(await readRegistry(dir)).toHaveLength(0);
  });

  it("rejects a bundle built against an incompatible apiVersion", async () => {
    await expect(
      installEngine("https://x.test/e.mjs", {
        dir,
        download: async () => fixtureBundle(999),
        confirm: async () => true,
      }),
    ).rejects.toThrow(/API version/);
    expect(await readRegistry(dir)).toHaveLength(0);
  });

  it("reinstalling the same engine id replaces, not duplicates, its registry entry", async () => {
    const options = {
      dir,
      download: async () => fixtureBundle(),
      confirm: async () => true,
    };

    await installEngine("https://x.test/e.mjs", options);
    await installEngine("https://x.test/e.mjs", options);

    expect(await readRegistry(dir)).toHaveLength(1);
  });
});

describe("loadEngines", () => {
  it("constructs a RoomSource per installed engine", async () => {
    await installEngine("https://x.test/e.mjs", {
      dir,
      download: async () => fixtureBundle(),
      confirm: async () => true,
    });

    const sources = await loadEngines(dir, ctx);
    expect(sources).toHaveLength(1);
    expect(await sources[0]!.loadConsoles()).toEqual([
      { name: "Fixture Console", alias: "FIX" },
    ]);
  });

  it("returns empty when nothing is installed", async () => {
    expect(await loadEngines(dir, ctx)).toEqual([]);
  });

  it("skips an installed engine whose apiVersion no longer matches", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Hand-place a bundle + registry entry with a bad apiVersion.
      await writeFile(
        join(dir, "stale.mjs"),
        fixtureBundle(999).replace(/"fixture"/g, '"stale"'),
      );
      await writeFile(
        join(dir, "registry.json"),
        JSON.stringify([
          {
            id: "stale",
            name: "Stale",
            version: "1.0.0",
            apiVersion: 999,
            sourceUrl: "https://x.test/stale.mjs",
            installedAt: "2026-07-13T00:00:00.000Z",
          },
        ]),
      );

      expect(await loadEngines(dir, ctx)).toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/stale/));
    } finally {
      warn.mockRestore();
    }
  });
});

describe("removeEngine", () => {
  it("deletes the bundle and registry entry", async () => {
    await installEngine("https://x.test/e.mjs", {
      dir,
      download: async () => fixtureBundle(),
      confirm: async () => true,
    });

    await removeEngine(dir, "fixture");

    expect(await readRegistry(dir)).toHaveLength(0);
    await expect(readFile(join(dir, "fixture.mjs"), "utf8")).rejects.toThrow();
  });

  it("throws when removing an engine that is not installed", async () => {
    await expect(removeEngine(dir, "nope")).rejects.toThrow(/not installed|No engine/);
  });
});

describe("validateEngine", () => {
  it("throws when there is no default export", () => {
    expect(() => validateEngine({})).toThrow(/default export/);
  });

  it("throws when the default export is missing a required field", () => {
    expect(() => validateEngine({ default: { id: "x" } })).toThrow(/valid RoomEngine/);
  });

  it("throws when the id is a path traversal, not a valid identifier", () => {
    expect(() =>
      validateEngine({
        default: {
          id: "../pwned",
          name: "x",
          version: "1.0.0",
          apiVersion: 1,
          create: () => ({}),
        },
      }),
    ).toThrow(/not a valid identifier|valid/);
  });
});

describe("defaultDownload", () => {
  it("reads a local filesystem path", async () => {
    const contents = "export default { id: \"fixture\" };\n";
    const path = join(dir, "engine.mjs");
    await writeFile(path, contents);

    expect(await defaultDownload(path)).toBe(contents);
  });
});
