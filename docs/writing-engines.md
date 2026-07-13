# Writing a roomba engine

roomba ships with **no sources**. Every console, search result, and download is
powered by an **engine** you install at runtime with `roomba engine install
<url>`. This guide is the complete reference for building one.

An engine is:

- a small standalone project that depends only on **`@praser/roomba-core`** (for
  types) and whatever it needs to talk to its source (e.g. an HTML parser);
- bundled into **a single ESM JavaScript file** (all dependencies inlined);
- **default-exporting a `RoomEngine`** — an object that describes the engine and
  builds a `RoomSource`.

You host that one file at a URL (or hand someone a local path), and
`roomba engine install <url>` downloads it, validates it, and starts using it.

> Looking for a complete, real-world engine? See
> [`roomba-vimm`](https://github.com/praser/roomba-vimm) — the Vimm's Lair
> engine — which this guide uses as its running example.

---

## Mental model

roomba does the cross-cutting work **on its side** so engines stay tiny:

- **The engine** fetches and parses. It lists a source's consoles, searches a
  console, and describes how to download a file. It returns the *full* result
  list — no filtering.
- **roomba** aggregates engines, normalizes console aliases
  (case-insensitively), applies `--region`/`--lang` filters, caches HTTP
  responses, and renders the tables.

A guiding principle: **engines return everything; roomba filters and normalizes
at display time.** A new engine only needs to fetch and parse — never implement
filtering, caching, or output formatting.

All of an engine's HTTP access goes through a `Fetcher` that roomba **injects**.
That is how caching (and `--no-cache`) works transparently: use the injected
fetcher, not the global `fetch`.

---

## The contract (`@praser/roomba-core`)

Add the contract as a **dev-only** dependency — it is types plus one small
constant, so it compiles away and adds nothing to your runtime bundle:

```bash
npm i -D @praser/roomba-core
```

### `RoomSource` — what your engine does

```ts
interface RoomSource {
  /** Stable id for this source, e.g. "vimm". Appears in the `consoles` table. */
  id: string;
  /** Base URL the source is rooted at. */
  baseURL: URL;

  /** List every console this source offers. */
  loadConsoles(): Promise<Console[]>;

  /** Resolve a console alias (e.g. "PS2") to this source's URL for it. */
  resolve(alias: string): URL;

  /**
   * Search a console (by alias) for games matching a query.
   * Return ONE entry per downloadable file (a release can expand into several
   * — one per disc / revision / format).
   */
  search(alias: string, query: string): Promise<GameFile[]>;

  /**
   * If this source recognizes a download URL, return the request (URL + any
   * required headers, e.g. a browser User-Agent or Referer) needed to fetch
   * it. Return null if the URL isn't yours.
   */
  downloadRequest(url: URL): DownloadRequest | null;
}
```

### Data types

```ts
interface Console {
  name: string;   // "PlayStation 2"
  alias: string;  // "PS2" — the stable id used in `search <alias> ...`
}

interface GameFile {
  name: string;        // full title incl. region/disc/revision markers
  region: string;      // "USA, Canada"
  version: string;     // "1.0"
  languages: string;   // "En,Fr,Es"
  rating: string;      // "9.6"
  size: string;        // "330 MB"
  downloadUrl: string; // direct URL for this specific file
}

interface DownloadRequest {
  url: URL;
  headers: Record<string, string>;
}
```

roomba only reads these fields — return them as strings even when empty (use
`""` or `"-"`), and let roomba handle presentation.

### `Fetcher` — how you make HTTP requests

```ts
interface HttpResponse {
  status: number;
  ok: boolean;
  body: string;
}

type Fetcher = (
  url: URL,
  headers?: Record<string, string>,
) => Promise<HttpResponse>;
```

You receive a `Fetcher` in `create(ctx)` (below). **Always use it** instead of
calling `fetch` directly — roomba may wrap it with its on-disk cache, and
`--no-cache` toggles that wrapper. Calling global `fetch` bypasses caching and
breaks offline behavior.

### `RoomEngine` — what your bundle default-exports

```ts
const ENGINE_API_VERSION = 1; // exported by @praser/roomba-core

interface EngineContext {
  fetcher: Fetcher; // injected by roomba; may be caching
}

interface RoomEngine {
  /**
   * Stable, unique id, e.g. "vimm". This is ALSO used as the on-disk filename
   * (`<id>.mjs`) and the registry key, so it must be a safe slug:
   * /^[a-z0-9][a-z0-9._-]*$/i  (letters/digits/dot/underscore/hyphen, no slashes).
   */
  id: string;
  name: string;         // human-readable, e.g. "Vimm's Lair"
  apiVersion: number;   // MUST equal ENGINE_API_VERSION (see Versioning)
  version: string;      // your engine's own semver, shown in `engine list`
  create(ctx: EngineContext): RoomSource;
}
```

Your module's **default export** must be a `RoomEngine`. `create` is where you
receive the injected fetcher and construct your `RoomSource`.

---

## Quick start

A roomba engine is a normal Node/TypeScript project with an esbuild bundle step.

### 1. `package.json`

```json
{
  "name": "roomba-engine-example",
  "version": "1.0.0",
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/example.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "node-html-parser": "^7.0.1"
  },
  "devDependencies": {
    "@praser/roomba-core": "^1.1.0",
    "@types/node": "^22.20.1",
    "esbuild": "^0.24.0",
    "typescript": "^5.7.2",
    "vitest": "^3.2.4"
  }
}
```

- Put `@praser/roomba-core` in **devDependencies** (types only).
- Put real runtime dependencies (an HTML/JSON parser, etc.) in
  **dependencies** — esbuild inlines them into the bundle.

### 2. `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

`tsc` is used only for type-checking (`noEmit`); **esbuild** produces the
shipped bundle.

### 3. Implement the `RoomSource`

Keep the source in its own module. Here is the shape (see `roomba-vimm`'s
`src/source.ts` for a full scraper):

```ts
// src/source.ts
import type {
  Console,
  DownloadRequest,
  Fetcher,
  GameFile,
  RoomSource,
} from "@praser/roomba-core";

export class ExampleRoomSource implements RoomSource {
  readonly id = "example";
  readonly baseURL = new URL("https://example.com");
  private readonly fetcher: Fetcher;

  constructor(fetcher: Fetcher) {
    this.fetcher = fetcher;
  }

  resolve(alias: string): URL {
    return new URL(`/vault/${alias}`, this.baseURL);
  }

  async loadConsoles(): Promise<Console[]> {
    const res = await this.fetcher(new URL("/consoles", this.baseURL));
    if (!res.ok) throw new Error(`HTTP ${res.status} listing consoles`);
    // ...parse res.body into Console[]...
    return [{ name: "Example Console", alias: "EX" }];
  }

  async search(alias: string, query: string): Promise<GameFile[]> {
    const url = this.resolve(alias);
    url.searchParams.set("q", query);
    const res = await this.fetcher(url);
    if (!res.ok) return []; // no matches → empty list, not an error
    // ...parse res.body into one GameFile per downloadable file...
    return [];
  }

  downloadRequest(url: URL): DownloadRequest | null {
    if (url.hostname !== "example.com") return null;
    return { url, headers: { "user-agent": "roomba-engine-example" } };
  }
}
```

Notes:
- **Use `this.fetcher`** for every request.
- A search with no matches should return `[]`, not throw.
- `downloadRequest` lets you attach headers some hosts require (browser
  User-Agent, Referer). Return `null` for URLs you don't own so other engines
  get a chance.

### 4. Default-export the `RoomEngine`

```ts
// src/index.ts
import { ENGINE_API_VERSION, type RoomEngine } from "@praser/roomba-core";
import { ExampleRoomSource } from "./source.js";

const engine: RoomEngine = {
  id: "example",
  name: "Example Source",
  apiVersion: ENGINE_API_VERSION,
  version: "1.0.0",
  create: (ctx) => new ExampleRoomSource(ctx.fetcher),
};

export default engine;
```

Set `apiVersion: ENGINE_API_VERSION` from the version of `@praser/roomba-core`
you built against — don't hard-code a number.

### 5. Bundle

```bash
npm run build   # -> dist/example.mjs
```

The bundle **must** be ESM. roomba stores every engine on disk as `<id>.mjs`
and imports it dynamically; the `.mjs` extension is what tells Node to treat it
as an ES module. esbuild's `--format=esm` gives you that, and `--bundle` inlines
`node-html-parser` (and anything else in `dependencies`) while leaving Node
built-ins (`node:url`, etc.) external — which is correct, since they exist in
the runtime.

---

## Testing

Because everything flows through the injected `Fetcher`, engines test fully
offline — hand your source a fake fetcher that returns canned HTML/JSON:

```ts
import { describe, expect, it } from "vitest";
import type { Fetcher } from "@praser/roomba-core";
import { ExampleRoomSource } from "../src/source.js";

const fakeFetcher = (body: string): Fetcher =>
  async () => ({ status: 200, ok: true, body });

describe("ExampleRoomSource", () => {
  it("parses the console list", async () => {
    const source = new ExampleRoomSource(fakeFetcher("<html>...</html>"));
    expect(await source.loadConsoles()).toEqual([
      { name: "Example Console", alias: "EX" },
    ]);
  });
});
```

Also worth a test: that your bundle's **default export is a valid engine**
(right `id`, `apiVersion`, and `create` returns something implementing
`RoomSource`).

---

## What roomba validates at install/load

When you (or a user) run `roomba engine install <url>`, roomba downloads the
bundle to a temp file, imports it, and checks the default export before it ever
lands under `<id>.mjs`. Loading an already-installed engine runs the same
checks. An engine is **rejected** (install fails; load skips it with a warning)
unless all of these hold:

1. The module has a **default export** that is an object.
2. It has string `id`, `name`, `version`; a number `apiVersion`; and a function
   `create`.
3. `id` matches `^[a-z0-9][a-z0-9._-]*$` (case-insensitive) — no path
   separators, no leading dot. (`id` becomes a filename and registry key.)
4. `apiVersion` **equals** roomba's `ENGINE_API_VERSION`.

If any check fails, `install` prints the specific reason and writes nothing.

---

## Versioning

There are **two** independent versions, and they mean different things:

| Field | What it is | Who bumps it |
|---|---|---|
| `apiVersion` | The **contract** version your engine targets (`ENGINE_API_VERSION`). An integer. | roomba, when `RoomSource`/`RoomEngine` change incompatibly. |
| `version` | Your **engine's own** semver. | You, on every engine release. |

roomba loads an engine only when `engine.apiVersion === ENGINE_API_VERSION`. If
roomba bumps the contract to `2`, a `apiVersion: 1` engine is refused with a
clear message (`engine targets API version 1, but roomba speaks 2`) until you
rebuild against the new `@praser/roomba-core` and republish. This is the
compatibility gate — it prevents a stale engine from half-working against a
changed contract.

Your `version` is cosmetic to roomba (shown in `roomba engine list`) but is how
*users* track your releases — follow semver for it.

---

## Hosting and installing

Publish the single `dist/*.mjs` somewhere fetchable and share the URL. Common
options: a GitHub Release asset, an object store, or any static host.

```bash
# From a URL (the normal case)
roomba engine install "https://example.com/example.mjs"

# From a local file (developing your own engine)
roomba engine install "file:///abs/path/to/dist/example.mjs"
roomba engine install "./dist/example.mjs"
```

`install` accepts `http(s)://` URLs, `file:` URLs, and local filesystem paths.
Other schemes are rejected.

Manage installed engines with:

```bash
roomba engine list            # id, name, version, source URL
roomba engine remove <id>     # delete the bundle + registry entry
roomba engine install <url>   # re-installing the same id upgrades it
```

Engines live under `(XDG_DATA_HOME ?? ~/.local/share)/roomba/engines/`: one
`<id>.mjs` per engine plus a `registry.json` index.

---

## Security model

**Installing an engine runs untrusted code.** A bundle's top-level code executes
the moment roomba imports it — before the `apiVersion`/shape validation, which
is a *correctness* check, not a sandbox. roomba's only trust gate is the
confirmation prompt on `install`:

```
$ roomba engine install "https://example.com/example.mjs"
⚠  Installs and runs untrusted code from:
   https://example.com/example.mjs
Continue? [y/N]
```

`--yes` skips the prompt for scripted installs. Only install engines from
sources you trust, and prefer hosts that let users verify what they're getting.

---

## Checklist

- [ ] Depends on `@praser/roomba-core` (devDependency, types only).
- [ ] `RoomSource` implemented; all HTTP goes through the injected `Fetcher`.
- [ ] `search` returns one `GameFile` per file, `[]` on no matches.
- [ ] Default export is a `RoomEngine` with a slug `id` and
      `apiVersion: ENGINE_API_VERSION`.
- [ ] Bundled to a single **ESM** file with esbuild (`--format=esm --bundle`).
- [ ] Tested offline through a fake `Fetcher`.
- [ ] Hosted at a URL; installs cleanly with `roomba engine install`.
