# External, Installable Engines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove roomba's bundled engine and let users install third-party engines at runtime via `roomba engine install <url>`.

**Architecture:** Turn the CLI's compile-time engine import into runtime plugin discovery. `@roomba/core` gains a published engine contract (`RoomEngine` + `ENGINE_API_VERSION`). `apps/cli` gains an engine manager (install/list/remove) and a loader that reads installed bundles from disk and constructs their `RoomSource`s. The Vimm engine moves to a standalone `roomba-engine-vimm` project that bundles itself to a single `.mjs` file.

**Tech Stack:** TypeScript (strict, NodeNext ESM), pnpm workspace, Node ≥ 22, commander, vitest, esbuild (engine bundling), node-html-parser (engine only).

## Global Constraints

- **Node ≥ 22**, pnpm (version pinned via root `packageManager`).
- All packages are ESM (`"type": "module"`), TypeScript `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` per `tsconfig.base.json`.
- Engine bundles are stored on disk as `<id>.mjs` under `enginesDir()` = `(XDG_DATA_HOME ?? ~/.local/share) + /roomba/engines`. The `.mjs` extension is required — the install dir has no `package.json`, so a `.js` bundle would be parsed as CommonJS and its `export default` would fail.
- `ENGINE_API_VERSION` is `1`. roomba loads an engine only when its `apiVersion` **equals** `ENGINE_API_VERSION`.
- An engine bundle's **default export** is a `RoomEngine`.
- Versions after this change: root `roomba` and `@roomba/cli` → `2.0.0`; `@roomba/core` → `1.1.0` (and no longer `private`); `roomba-engine-vimm` → `1.0.0`.
- TDD: write the failing test first. Commit after each green task.
- Run the full suite with `pnpm test` (vitest) from the repo root.

---

### Task 1: Engine contract in `@roomba/core`

**Files:**
- Modify: `packages/core/src/index.ts` (append contract exports)
- Modify: `packages/core/package.json` (version `1.1.0`, drop `private`)
- Test: `packages/core/test/engine.test.ts` (create)

**Interfaces:**
- Consumes: existing `Fetcher`, `RoomSource` from the same file.
- Produces:
  - `ENGINE_API_VERSION: number` (value `1`)
  - `interface EngineContext { fetcher: Fetcher }`
  - `interface RoomEngine { id: string; name: string; apiVersion: number; version: string; create(ctx: EngineContext): RoomSource }`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/engine.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- packages/core`
Expected: FAIL — `ENGINE_API_VERSION`, `RoomEngine`, `EngineContext` are not exported.

- [ ] **Step 3: Add the contract to core**

Append to `packages/core/src/index.ts` (after the existing `RoomSource` interface):

```ts
/**
 * The engine contract major version roomba speaks. Bump when RoomSource or
 * RoomEngine change incompatibly; roomba refuses to load an engine whose
 * apiVersion differs from this.
 */
export const ENGINE_API_VERSION = 1;

/** What roomba injects into an engine when constructing its RoomSource. */
export interface EngineContext {
  /**
   * HTTP fetcher roomba provides (may be caching). Engines should use this
   * rather than calling fetch directly, so caching/offline behavior works.
   */
  fetcher: Fetcher;
}

/** The value an engine bundle must default-export. */
export interface RoomEngine {
  /** Stable, unique id, e.g. "vimm". Also the on-disk filename + registry key. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** The ENGINE_API_VERSION the engine was built against. */
  apiVersion: number;
  /** The engine's own semver, shown in `roomba engine list`. */
  version: string;
  /** Construct the RoomSource. */
  create(ctx: EngineContext): RoomSource;
}
```

- [ ] **Step 4: Make core publishable + bump version**

Edit `packages/core/package.json`: remove the `"private": true` line and change `"version": "1.0.0"` to `"version": "1.1.0"`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- packages/core`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index.ts packages/core/package.json packages/core/test/engine.test.ts
git commit -m "feat(core): add RoomEngine contract and ENGINE_API_VERSION"
```

---

### Task 2: Engine manager (`apps/cli/src/engines.ts`)

Pure, injectable functions for validating, installing, listing, removing, and loading engines. No network or stdin here — those are injected — so the whole module is unit-testable against fixture bundles in a temp dir.

**Files:**
- Create: `apps/cli/src/engines.ts`
- Test: `apps/cli/test/engines.test.ts` (create)

**Interfaces:**
- Consumes: `ENGINE_API_VERSION`, `EngineContext`, `RoomEngine`, `RoomSource` from `@roomba/core`.
- Produces:
  - `defaultEnginesDir(): string`
  - `interface RegistryEntry { id; name; version; apiVersion; sourceUrl; installedAt }` (all `string` except `apiVersion: number`)
  - `readRegistry(dir: string): Promise<RegistryEntry[]>`
  - `validateEngine(mod: unknown): RoomEngine`
  - `importEngine(bundlePath: string): Promise<RoomEngine>`
  - `interface InstallOptions { dir: string; download: (url: string) => Promise<string>; confirm: () => Promise<boolean> }`
  - `installEngine(url: string, options: InstallOptions): Promise<RegistryEntry | null>`
  - `removeEngine(dir: string, id: string): Promise<void>`
  - `loadEngines(dir: string, ctx: EngineContext): Promise<RoomSource[]>`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/engines.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineContext } from "@roomba/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
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
    // Hand-place a bundle + registry entry with a bad apiVersion.
    await writeFile(join(dir, "stale.mjs"), fixtureBundle(999).replace(/"fixture"/g, '"stale"'));
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- apps/cli/test/engines.test.ts`
Expected: FAIL — cannot resolve `../src/engines.js`.

- [ ] **Step 3: Implement the engine manager**

Create `apps/cli/src/engines.ts`:

```ts
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ENGINE_API_VERSION,
  type EngineContext,
  type RoomEngine,
  type RoomSource,
} from "@roomba/core";

/** On-disk location for installed engines (honors XDG_DATA_HOME). */
export function defaultEnginesDir(): string {
  return join(
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
    "roomba",
    "engines",
  );
}

export interface RegistryEntry {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  sourceUrl: string;
  installedAt: string;
}

function registryFile(dir: string): string {
  return join(dir, "registry.json");
}

function bundleFile(dir: string, id: string): string {
  return join(dir, `${id}.mjs`);
}

/** Read the installed-engine registry. Missing or corrupt → empty list. */
export async function readRegistry(dir: string): Promise<RegistryEntry[]> {
  try {
    return JSON.parse(await readFile(registryFile(dir), "utf8")) as RegistryEntry[];
  } catch {
    return [];
  }
}

async function writeRegistry(dir: string, entries: RegistryEntry[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(registryFile(dir), JSON.stringify(entries, null, 2));
}

/**
 * Validate that a dynamically imported module's default export is a RoomEngine
 * built against the contract version we support. Throws with a clear message
 * otherwise.
 */
export function validateEngine(mod: unknown): RoomEngine {
  const engine = (mod as { default?: unknown }).default;
  if (!engine || typeof engine !== "object") {
    throw new Error("engine module has no default export");
  }
  const e = engine as Record<string, unknown>;
  if (
    typeof e.id !== "string" ||
    typeof e.name !== "string" ||
    typeof e.version !== "string" ||
    typeof e.apiVersion !== "number" ||
    typeof e.create !== "function"
  ) {
    throw new Error("default export is not a valid RoomEngine");
  }
  if (e.apiVersion !== ENGINE_API_VERSION) {
    throw new Error(
      `engine targets API version ${e.apiVersion}, but roomba speaks ${ENGINE_API_VERSION}`,
    );
  }
  return engine as RoomEngine;
}

/** Import an engine bundle from a local file and return its validated RoomEngine. */
export async function importEngine(bundlePath: string): Promise<RoomEngine> {
  const mod = await import(pathToFileURL(bundlePath).href);
  return validateEngine(mod);
}

export interface InstallOptions {
  dir: string;
  /** Fetch the bundle source for a URL. Injected for testability. */
  download: (url: string) => Promise<string>;
  /** Ask the user to confirm. Injected for testability. Return true to proceed. */
  confirm: () => Promise<boolean>;
}

/**
 * Download, validate, and register an engine from a URL. Returns the registry
 * entry, or null if the user declined confirmation.
 */
export async function installEngine(
  url: string,
  options: InstallOptions,
): Promise<RegistryEntry | null> {
  if (!(await options.confirm())) return null;

  await mkdir(options.dir, { recursive: true });
  const source = await options.download(url);

  // Write to a temp file first so a bad bundle never lands under <id>.mjs.
  const tmpDir = await mkdtemp(join(options.dir, ".install-"));
  const tmpFile = join(tmpDir, "engine.mjs");
  await writeFile(tmpFile, source);

  let engine: RoomEngine;
  try {
    engine = await importEngine(tmpFile);
  } catch (error) {
    await rm(tmpDir, { recursive: true, force: true });
    throw error;
  }

  await rename(tmpFile, bundleFile(options.dir, engine.id));
  await rm(tmpDir, { recursive: true, force: true });

  const entry: RegistryEntry = {
    id: engine.id,
    name: engine.name,
    version: engine.version,
    apiVersion: engine.apiVersion,
    sourceUrl: url,
    installedAt: new Date().toISOString(),
  };
  const others = (await readRegistry(options.dir)).filter((e) => e.id !== engine.id);
  await writeRegistry(options.dir, [...others, entry]);
  return entry;
}

/** Remove an installed engine by id. Throws if it is not installed. */
export async function removeEngine(dir: string, id: string): Promise<void> {
  const entries = await readRegistry(dir);
  if (!entries.some((e) => e.id === id)) {
    throw new Error(`No engine named "${id}" is installed.`);
  }
  await rm(bundleFile(dir, id), { force: true });
  await writeRegistry(
    dir,
    entries.filter((e) => e.id !== id),
  );
}

/**
 * Load every installed engine and construct its RoomSource with the given
 * context. A broken or incompatible engine is skipped with a warning.
 */
export async function loadEngines(
  dir: string,
  ctx: EngineContext,
): Promise<RoomSource[]> {
  const sources: RoomSource[] = [];
  for (const entry of await readRegistry(dir)) {
    try {
      const engine = await importEngine(bundleFile(dir, entry.id));
      sources.push(engine.create(ctx));
    } catch (error) {
      console.warn(
        `roomba: skipping engine "${entry.id}": ${(error as Error).message}`,
      );
    }
  }
  return sources;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- apps/cli/test/engines.test.ts`
Expected: PASS (all cases). If the dynamic import of `.mjs` fails, confirm the fixture is written with an `.mjs` extension (it is, via `bundleFile`/`tmpFile`).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/engines.ts apps/cli/test/engines.test.ts
git commit -m "feat(cli): add engine manager (install/list/remove/load)"
```

---

### Task 3: Wire the manager into the CLI + drop the built-in engine

Replace the compile-time `@roomba/vimm` dependency with runtime engine loading, add the `roomba engine` command, and handle the empty-engine state. Bump `@roomba/cli` and the root to `2.0.0`.

**Files:**
- Modify: `apps/cli/src/sources.ts` (own `directFetcher`, async `createSources` via `loadEngines`)
- Modify: `apps/cli/src/index.ts` (`engine` command, empty-state, `await createSources`)
- Modify: `apps/cli/package.json` (remove `@roomba/vimm`, version `2.0.0`)
- Modify: `apps/cli/tsconfig.json` (remove the `engines/vimm` project reference)
- Modify: `package.json` (root, version `2.0.0`)
- Test: `apps/cli/test/sources.test.ts` (create)

**Interfaces:**
- Consumes: `defaultEnginesDir`, `loadEngines`, `readRegistry`, `installEngine`, `removeEngine`, `RegistryEntry` from `./engines.js`; `renderTable` from `./table.js`; `createCachingFetcher` from `./cache.js`.
- Produces (changed): `createSources(options: { cache: boolean }): Promise<RoomSource[]>` (now async); `directFetcher: Fetcher` moves here.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/sources.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSources } from "../src/sources.js";

let prevDataHome: string | undefined;
let dataHome: string;

beforeEach(async () => {
  prevDataHome = process.env.XDG_DATA_HOME;
  dataHome = await mkdtemp(join(tmpdir(), "roomba-data-"));
  process.env.XDG_DATA_HOME = dataHome;
});

afterEach(async () => {
  if (prevDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = prevDataHome;
  await rm(dataHome, { recursive: true, force: true });
});

describe("createSources", () => {
  it("returns no sources when no engines are installed", async () => {
    const sources = await createSources({ cache: false });
    expect(sources).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- apps/cli/test/sources.test.ts`
Expected: FAIL — `createSources` is currently synchronous and imports `@roomba/vimm`.

- [ ] **Step 3: Rewrite `sources.ts`**

Replace the top of `apps/cli/src/sources.ts` (the imports, `createSources`, and `directFetcher`) so the file reads:

```ts
import type { Fetcher, HttpResponse, RoomSource } from "@roomba/core";
import { createCachingFetcher } from "./cache.js";
import { defaultEnginesDir, loadEngines } from "./engines.js";

/** Default uncached Fetcher: a plain HTTP GET via global fetch. */
export const directFetcher: Fetcher = async (url, headers): Promise<HttpResponse> => {
  const response = await fetch(url, { headers });
  return { status: response.status, ok: response.ok, body: await response.text() };
};

/** Build the set of data sources from the user's installed engines. */
export async function createSources(options: { cache: boolean }): Promise<RoomSource[]> {
  const fetcher = options.cache ? createCachingFetcher(directFetcher) : directFetcher;
  return loadEngines(defaultEnginesDir(), { fetcher });
}
```

Leave `ConsoleRow` and `collectConsoles` in the file unchanged below this.

- [ ] **Step 4: Run the sources test to verify it passes**

Run: `pnpm test -- apps/cli/test/sources.test.ts`
Expected: PASS.

- [ ] **Step 5: Update `index.ts` — await createSources, empty-state, engine command**

In `apps/cli/src/index.ts`:

Add imports at the top (below the existing imports):

```ts
import { createInterface } from "node:readline/promises";
import {
  defaultEnginesDir,
  installEngine,
  readRegistry,
  removeEngine,
} from "./engines.js";
```

Add these helpers just after `program.name(...)`:

```ts
function printNoEngines(): void {
  console.log("No engines installed. Install one with:\n  roomba engine install <url>");
}

async function confirmInstall(url: string, yes: boolean): Promise<boolean> {
  console.warn(`⚠  Installs and runs untrusted code from:\n   ${url}`);
  if (yes) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Continue? [y/N] ");
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
```

In the **consoles** action, replace its body with:

```ts
    const sources = await createSources({ cache: options.cache });
    if (sources.length === 0) return printNoEngines();
    const rows = await collectConsoles(sources);
    const table = renderTable(
      ["Console", "Alias", "Sources"],
      rows.map((row) => [row.name, row.alias, row.sources.join(", ")]),
    );
    console.log(table);
```

In the **search** action, change `const sources = createSources(...)` to `const sources = await createSources(...)` and add, immediately after it:

```ts
      if (sources.length === 0) return printNoEngines();
```

In the **download** action, replace its body with:

```ts
    const sources = await createSources({ cache: false });
    if (sources.length === 0) return printNoEngines();
    await downloadFile(sources, url, options.output);
```

Add the `engine` command group just before the final `try { await program.parseAsync(); }` block:

```ts
const engine = program.command("engine").description("Manage roomba engines");

engine
  .command("install")
  .argument("<url>", "URL of an engine bundle (a single JS file)")
  .option("-y, --yes", "skip the confirmation prompt")
  .description("Download and install an engine from a URL")
  .action(async (url: string, options: { yes?: boolean }) => {
    const entry = await installEngine(url, {
      dir: defaultEnginesDir(),
      download: async (u) => {
        const res = await fetch(u);
        if (!res.ok) throw new Error(`Failed to download ${u}: HTTP ${res.status}`);
        return res.text();
      },
      confirm: () => confirmInstall(url, options.yes ?? false),
    });
    if (!entry) {
      console.log("Installation cancelled.");
      return;
    }
    console.log(`Installed '${entry.id}' (${entry.name} ${entry.version}).`);
  });

engine
  .command("list")
  .description("List installed engines")
  .action(async () => {
    const entries = await readRegistry(defaultEnginesDir());
    if (entries.length === 0) {
      console.log("No engines installed.");
      return;
    }
    const table = renderTable(
      ["Id", "Name", "Version", "Source"],
      entries.map((e) => [e.id, e.name, e.version, e.sourceUrl]),
    );
    console.log(table);
  });

engine
  .command("remove")
  .argument("<id>", "engine id (see `roomba engine list`)")
  .description("Remove an installed engine")
  .action(async (id: string) => {
    await removeEngine(defaultEnginesDir(), id);
    console.log(`Removed '${id}'.`);
  });
```

- [ ] **Step 6: Remove the `@roomba/vimm` dependency + bump versions**

- Edit `apps/cli/package.json`: delete the `"@roomba/vimm": "workspace:*",` line from `dependencies`; change `"version": "1.0.0"` to `"version": "2.0.0"`.
- Edit `apps/cli/tsconfig.json`: remove the `{ "path": "../../engines/vimm" }` entry from `references` (leaving only the core reference).
- Edit root `package.json`: change `"version": "1.0.0"` to `"version": "2.0.0"`.

- [ ] **Step 7: Reinstall, build, and run the full suite**

```bash
pnpm install
pnpm build
pnpm test
```

Expected: install relinks without `@roomba/vimm`; build succeeds; all tests pass (the existing `games`/`download`/`table`/`cache` tests are unaffected because `searchGames`/`downloadFile` still take `RoomSource[]`).

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/sources.ts apps/cli/src/index.ts apps/cli/package.json apps/cli/tsconfig.json apps/cli/test/sources.test.ts package.json pnpm-lock.yaml
git commit -m "feat(cli): load engines at runtime, add engine command, drop built-in source"
```

---

### Task 4: Extract the Vimm engine into `roomba-engine-vimm`

Create a standalone project that reuses the existing Vimm code, default-exports a `RoomEngine`, and bundles to a single `.mjs` file with esbuild. Add it as a temporary workspace member so `@roomba/core` resolves for building; it is destined for its own repo (see Task 5).

**Files:**
- Create: `roomba-engine-vimm/package.json`
- Create: `roomba-engine-vimm/tsconfig.json`
- Create: `roomba-engine-vimm/vitest.config.ts`
- Create: `roomba-engine-vimm/README.md`
- Create: `roomba-engine-vimm/src/source.ts` (from `engines/vimm/src/index.ts`)
- Create: `roomba-engine-vimm/src/parse.ts` (copy of `engines/vimm/src/parse.ts`)
- Create: `roomba-engine-vimm/src/index.ts` (RoomEngine default export)
- Create: `roomba-engine-vimm/test/parse.test.ts` (copy)
- Create: `roomba-engine-vimm/test/vimm.test.ts` (copy)
- Modify: `pnpm-workspace.yaml` (add `roomba-engine-vimm`)

**Interfaces:**
- Consumes: `ENGINE_API_VERSION`, `RoomEngine`, and the `RoomSource`/`Fetcher`/etc. types from `@roomba/core`.
- Produces: `roomba-engine-vimm/dist/vimm.mjs` — an ESM bundle whose default export is a `RoomEngine` with `id: "vimm"`.

- [ ] **Step 1: Copy the source files unchanged**

```bash
mkdir -p roomba-engine-vimm/src roomba-engine-vimm/test
cp engines/vimm/src/parse.ts roomba-engine-vimm/src/parse.ts
cp engines/vimm/src/index.ts roomba-engine-vimm/src/source.ts
cp engines/vimm/test/parse.test.ts roomba-engine-vimm/test/parse.test.ts
cp engines/vimm/test/vimm.test.ts roomba-engine-vimm/test/vimm.test.ts
```

- [ ] **Step 2: Adjust `vimm.test.ts` import if needed**

Open `roomba-engine-vimm/test/vimm.test.ts`. If it imports from `../src/index.js`, change that import to `../src/source.js` (the `VimmRoomSource`/`directFetcher`/`VimmOptions` now live in `source.ts`). Leave `parse.test.ts` as-is (it imports `../src/parse.js`).

- [ ] **Step 3: Create the RoomEngine entry point**

Create `roomba-engine-vimm/src/index.ts`:

```ts
import { ENGINE_API_VERSION, type RoomEngine } from "@roomba/core";
import { VimmRoomSource } from "./source.js";

export { VimmRoomSource } from "./source.js";

const engine: RoomEngine = {
  id: "vimm",
  name: "Vimm's Lair",
  apiVersion: ENGINE_API_VERSION,
  version: "1.0.0",
  create: (ctx) => new VimmRoomSource({ fetcher: ctx.fetcher }),
};

export default engine;
```

- [ ] **Step 4: Create the project config files**

Create `roomba-engine-vimm/package.json`:

```json
{
  "name": "roomba-engine-vimm",
  "version": "1.0.0",
  "description": "Vimm's Lair engine for roomba",
  "license": "MIT",
  "author": "Rubens Praser Junior",
  "type": "module",
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/vimm.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "node-html-parser": "^7.0.1"
  },
  "devDependencies": {
    "@roomba/core": "workspace:*",
    "@types/node": "^22.20.1",
    "esbuild": "^0.24.0",
    "typescript": "^5.7.2",
    "vitest": "^3.2.4"
  }
}
```

Create `roomba-engine-vimm/tsconfig.json` (self-contained — this project will leave the monorepo):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

Create `roomba-engine-vimm/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

Create `roomba-engine-vimm/README.md`:

```markdown
# roomba-engine-vimm

A [roomba](https://github.com/) engine for [Vimm's Lair](https://vimm.net).

## Build

```bash
pnpm install
pnpm build   # -> dist/vimm.mjs
```

## Install into roomba

```bash
roomba engine install <url-to-dist/vimm.mjs>
```

The bundle default-exports a `RoomEngine` (see `@roomba/core`) with `id: "vimm"`,
built against `ENGINE_API_VERSION` 1.
```

- [ ] **Step 5: Register as a temporary workspace member**

Edit `pnpm-workspace.yaml` so `packages` is:

```yaml
packages:
  - "packages/*"
  - "apps/*"
  - "roomba-engine-vimm"
```

(The `engines/*` glob is removed here; `engines/vimm` is deleted in Task 5.)

- [ ] **Step 6: Install, typecheck, test, and build the bundle**

```bash
pnpm install
pnpm --filter roomba-engine-vimm typecheck
pnpm --filter roomba-engine-vimm test
pnpm --filter roomba-engine-vimm build
```

Expected: typecheck clean; the moved `parse`/`vimm` tests pass; `roomba-engine-vimm/dist/vimm.mjs` is produced with `node-html-parser` inlined (no `node:*`-only imports remain external issues — Node builtins stay external, which is correct).

- [ ] **Step 7: Verify the bundle default-exports a valid engine**

```bash
node --input-type=module -e "import e from './roomba-engine-vimm/dist/vimm.mjs'; console.log(e.default?.id ?? e.id, (e.default ?? e).apiVersion)"
```

Expected output: `vimm 1`
(When imported as a namespace the default is on `.default`; the check above tolerates both.)

- [ ] **Step 8: Commit**

```bash
git add roomba-engine-vimm pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat: extract Vimm engine into standalone roomba-engine-vimm"
```

---

### Task 5: Delete the old engine, verify end-to-end, update docs

Remove `engines/vimm` from roomba, drop it from the test globs, run the real install flow against the built bundle, and update the docs to describe the plugin model.

**Files:**
- Delete: `engines/vimm/**`
- Modify: `vitest.config.ts` (remove the `engines/*` include line)
- Modify: `README.md` (repository layout + engine command)
- Modify: `apps/cli/README.md` (document `roomba engine ...`)

**Interfaces:** none produced.

- [ ] **Step 1: Delete the in-repo engine**

```bash
git rm -r engines/vimm
```

- [ ] **Step 2: Remove the engines test glob**

Edit `vitest.config.ts` and delete the `"engines/*/test/**/*.test.ts",` line, leaving only the `packages/*` and `apps/*` include entries. (The standalone engine has its own `vitest.config.ts`.)

- [ ] **Step 3: Rebuild and run the roomba suite**

```bash
pnpm install
pnpm build
pnpm test
```

Expected: build succeeds with no `engines/vimm` reference; roomba's suite passes and no longer runs the Vimm tests.

- [ ] **Step 4: End-to-end install verification against the real bundle**

```bash
export XDG_DATA_HOME="$(mktemp -d)"
node apps/cli/dist/index.js consoles
# Expected: "No engines installed. Install one with: roomba engine install <url>"

node apps/cli/dist/index.js engine install "file://$PWD/roomba-engine-vimm/dist/vimm.mjs" --yes
# Expected: "Installed 'vimm' (Vimm's Lair 1.0.0)."

node apps/cli/dist/index.js engine list
# Expected: a table row for id "vimm"

node apps/cli/dist/index.js consoles
# Expected: a table of consoles scraped from Vimm (network required)

node apps/cli/dist/index.js engine remove vimm
# Expected: "Removed 'vimm'."

node apps/cli/dist/index.js consoles
# Expected: the "No engines installed" message again

unset XDG_DATA_HOME
```

If `engine install` errors on the dynamic import, confirm the bundle is `.mjs` and that `validateEngine` reads `.default`.

- [ ] **Step 5: Update the docs**

In `README.md`:
- In the intro, change "The first (and currently only) source is Vimm's Lair" to describe engines as installable plugins, e.g.: "roomba ships with no sources — you install **engines** (e.g. [roomba-engine-vimm](https://github.com/)) with `roomba engine install <url>`."
- In the Commands table, add rows:
  - `roomba engine install <url>` — Download and install an engine from a URL
  - `roomba engine list` — List installed engines
  - `roomba engine remove <id>` — Remove an installed engine
- In the Repository layout section, remove the `engines/*` tier row (the workspace now ships only `packages/*` and `apps/*`; engines live in their own repos).

In `apps/cli/README.md`: add an "Engines" section documenting `install` (with the confirmation prompt and `--yes`), `list`, and `remove`, and note that with no engines installed the data commands print the install hint.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove bundled Vimm engine and document the engine plugin model"
```

---

## Notes for the maintainer (post-implementation)

- **Extracting `roomba-engine-vimm` to its own repo:** move the `roomba-engine-vimm/` directory out, remove its line from `pnpm-workspace.yaml`, and change its `@roomba/core` devDependency from `workspace:*` to a published range (e.g. `^1.1.0`) once core is on npm.
- **Publishing `@roomba/core`:** it is now publishable (`private` removed, `1.1.0`). Run `npm publish --access public` from `packages/core` when ready; engine authors then `npm i -D @roomba/core` for types.

## Self-Review

- **Spec coverage:** contract (Task 1); on-disk layout + registry (Task 2); install/list/remove with confirm + `--yes` (Tasks 2–3); async loader + empty state + skip-incompatible (Tasks 2–3); extracted standalone engine with esbuild bundle (Task 4); remove built-in + E2E + versioning + docs (Tasks 3, 5). All spec sections map to a task.
- **Placeholder scan:** every code step contains complete code; no TBD/TODO; doc edits specify exact text.
- **Type consistency:** `RegistryEntry`, `EngineContext`, `InstallOptions`, `createSources: Promise<RoomSource[]>`, and `.mjs` bundle naming are used identically across Tasks 2, 3, and the fixtures.
