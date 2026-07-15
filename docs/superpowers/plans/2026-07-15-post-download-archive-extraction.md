# Post-download Archive Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Batocera, after a download lands in `/userdata/roms/<alias>/`, extract the archive into a per-archive subfolder **only** when the target system can't read that archive format directly, then delete the archive — so disc games (psx `.zip`, etc.) become playable without a manual unzip, while arcade romsets (mame `.zip`) are never touched.

**Architecture:** Follows roomba's existing split — `@praser/roomba-core` owns the accepted-extensions catalog and a **pure** placement decision (`planPostDownload`); the CLI owns the I/O (`extract.ts`, a `7z`-based executor with an injectable process runner) and wires it into `download.ts` right after ROM placement. Every seam that carries logic is a pure or dependency-injected function, tested offline exactly like the existing `resumePlan` / `resolveDestination` helpers.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node ≥ 22, Vitest, pnpm workspaces. Extraction shells out to `7z` (p7zip), which Batocera ships.

## Global Constraints

- **ESM import specifiers end in `.js`** even for `.ts` sources (e.g. `import { planPostDownload } from "@praser/roomba-core"` / `from "./extract.js"`). Match the surrounding files.
- **`roomba-core` stays I/O-free.** No `node:fs`, `node:child_process`, or network in `packages/core`. Pure functions and data only (importing `node:path` is also disallowed there — use the tiny inline `fileExt` helper defined in Task 2).
- **Extractable archive formats are exactly `zip`, `7z`, `rar`** (lowercase, no dot). Nothing else is auto-extracted.
- **Extraction applies only to Batocera ROM placement** (`Destination` of `kind: "roms"`). `-o` / `~/Downloads` placements always keep the raw file.
- **Best-effort failure posture** (mirrors `refreshLibrary` in `apps/cli/src/batocera.ts`): a missing `7z` binary or a non-zero exit **warns to stderr, keeps the archive, never throws, never changes `process.exitCode`**. The archive is deleted **only** after a verified exit-0 extraction.
- **Tests run fully offline** — no real `spawn`, no network. Inject fakes, as the existing suites do.
- Commit messages end with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

Run the whole suite with `pnpm test`; a single file with `pnpm vitest run <path>`.

---

## File Structure

- `packages/core/src/extensions.ts` **(create)** — `SYSTEM_EXTENSIONS` map, `acceptedExtensions`, `EXTRACTABLE`, `PostDownloadPlan`, `planPostDownload`. Pure.
- `packages/core/src/index.ts` **(modify)** — re-export the new symbols.
- `packages/core/test/extensions.test.ts` **(create)** — decision truth-table + drift/orphan tests.
- `apps/cli/src/extract.ts` **(create)** — `extractArchive` executor + default `run`.
- `apps/cli/test/extract.test.ts` **(create)** — executor tests with an injected `run`.
- `apps/cli/src/download.ts` **(modify)** — add exported pure `resolvePostDownload`, add `afterPlacement`, route both `maybeRefresh` call sites through it.
- `apps/cli/test/download.test.ts` **(modify)** — tests for `resolvePostDownload`.

Full `SYSTEM_EXTENSIONS` data lives in **Appendix A** (paste verbatim in Task 1).

---

## Task 1: Accepted-extensions catalog (core data)

**Files:**
- Create: `packages/core/src/extensions.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/extensions.test.ts`

**Interfaces:**
- Consumes: `CONSOLES` from `./consoles.js` (for the drift test only).
- Produces:
  - `SYSTEM_EXTENSIONS: Readonly<Record<string, readonly string[]>>` — accepted extensions per alias, lowercase, no leading dot.
  - `acceptedExtensions(alias: string): readonly string[]` — the alias's list, or `[]` if the alias has no entry.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/extensions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CONSOLES } from "../src/consoles.js";
import { acceptedExtensions, SYSTEM_EXTENSIONS } from "../src/extensions.js";

// Aliases intentionally without an accepted-extensions entry (no authoritative
// _info.txt data on hand). Runtime treats these as "keep" (never extract).
const UNMAPPED_ALIASES = new Set(["iortcw"]);

describe("SYSTEM_EXTENSIONS catalog", () => {
  it("returns a known system's accepted extensions, lowercase without dots", () => {
    expect(acceptedExtensions("psx")).toEqual([
      "cue", "img", "mdf", "pbp", "toc", "cbn", "m3u", "ccd", "chd", "iso",
    ]);
  });

  it("returns an empty array for an unknown alias", () => {
    expect(acceptedExtensions("not-a-real-system")).toEqual([]);
  });

  it("has no orphan keys — every mapped alias is a real console", () => {
    const aliases = new Set(CONSOLES.map((c) => c.alias));
    const orphans = Object.keys(SYSTEM_EXTENSIONS).filter((a) => !aliases.has(a));
    expect(orphans).toEqual([]);
  });

  it("covers every catalog alias except the documented unmapped set", () => {
    const missing = CONSOLES.map((c) => c.alias).filter(
      (a) => !(a in SYSTEM_EXTENSIONS) && !UNMAPPED_ALIASES.has(a),
    );
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/test/extensions.test.ts`
Expected: FAIL — cannot resolve `../src/extensions.js` (module not created yet).

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/extensions.ts`. Start with this header and the `acceptedExtensions` helper, then paste the **entire `SYSTEM_EXTENSIONS` literal from Appendix A** as the map body:

```ts
/**
 * Accepted ROM-file extensions per Batocera system alias, sourced from each
 * system's `_info.txt` "ROM files extensions accepted" line. Lowercase, no
 * leading dot. THE authority for whether a downloaded file is runnable as-is
 * (and therefore whether a downloaded archive must be extracted first).
 */
export const SYSTEM_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  // ↓↓↓ paste every entry from Appendix A here, verbatim ↓↓↓
  // e.g.  psx: ["cue", "img", "mdf", "pbp", "toc", "cbn", "m3u", "ccd", "chd", "iso"],
};

/** Accepted extensions for an alias (empty array if the alias has no entry). */
export function acceptedExtensions(alias: string): readonly string[] {
  return SYSTEM_EXTENSIONS[alias] ?? [];
}
```

Add the re-exports to `packages/core/src/index.ts` (near the existing
`export { CONSOLES, CONSOLE_BY_ALIAS } from "./consoles.js";` line):

```ts
export { SYSTEM_EXTENSIONS, acceptedExtensions } from "./extensions.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/test/extensions.test.ts`
Expected: PASS (4 tests). If "covers every catalog alias" fails, the printed
`missing` array names aliases absent from Appendix A — add them from their
`_info.txt`, or add to `UNMAPPED_ALIASES` only if no data exists.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/extensions.ts packages/core/src/index.ts packages/core/test/extensions.test.ts
git commit -m "feat(core): accepted-extensions catalog per Batocera alias

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Placement decision (core, pure)

**Files:**
- Modify: `packages/core/src/extensions.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/extensions.test.ts`

**Interfaces:**
- Consumes: `acceptedExtensions` (Task 1).
- Produces:
  - `EXTRACTABLE: readonly ["zip", "7z", "rar"]`
  - `type PostDownloadPlan = { kind: "keep" } | { kind: "extract"; archive: string } | { kind: "manual"; ext: string }`
  - `planPostDownload(alias: string, filename: string): PostDownloadPlan`

Decision rule (unknown alias defaults to `keep` so missing data can never corrupt a romset):

| condition | plan |
|---|---|
| alias has no entry (`acceptedExtensions` empty) | `keep` |
| ext ∈ accepted | `keep` |
| ext ∉ accepted, ext ∈ EXTRACTABLE | `extract` |
| ext ∉ accepted, ext ∉ EXTRACTABLE | `manual` |

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/extensions.test.ts`:

```ts
import { planPostDownload } from "../src/extensions.js";

describe("planPostDownload", () => {
  it("keeps an archive the system reads directly (cartridge)", () => {
    expect(planPostDownload("snes", "Game.zip")).toEqual({ kind: "keep" });
  });

  it("keeps an arcade romset zip — never extracts it", () => {
    expect(planPostDownload("mame", "sf2.zip")).toEqual({ kind: "keep" });
  });

  it("extracts an archive the system cannot read (disc)", () => {
    expect(planPostDownload("psx", "Some Game.zip")).toEqual({
      kind: "extract",
      archive: "Some Game.zip",
    });
  });

  it("extracts rar and 7z too", () => {
    expect(planPostDownload("psx", "Game.rar").kind).toBe("extract");
    expect(planPostDownload("psx", "Game.7z").kind).toBe("extract");
  });

  it("keeps a disc image the system already reads", () => {
    expect(planPostDownload("psx", "Game.chd")).toEqual({ kind: "keep" });
  });

  it("is case-insensitive on the extension", () => {
    expect(planPostDownload("psx", "GAME.ZIP").kind).toBe("extract");
  });

  it("flags a non-accepted, non-extractable file as manual", () => {
    expect(planPostDownload("psx", "Game.rev")).toEqual({ kind: "manual", ext: "rev" });
  });

  it("keeps files for an unknown alias (no data → never touch)", () => {
    expect(planPostDownload("not-a-real-system", "Game.zip")).toEqual({ kind: "keep" });
  });

  it("keeps a file with no extension", () => {
    expect(planPostDownload("psx", "README")).toEqual({ kind: "keep" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/test/extensions.test.ts`
Expected: FAIL — `planPostDownload` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `packages/core/src/extensions.ts`:

```ts
/** Archive formats roomba can extract (lowercase, no dot). */
export const EXTRACTABLE = ["zip", "7z", "rar"] as const;

/** What to do with a file just placed in an alias's ROM folder. */
export type PostDownloadPlan =
  | { kind: "keep" } // extension accepted, or no data for the alias → leave it
  | { kind: "extract"; archive: string } // not accepted but extractable → unpack
  | { kind: "manual"; ext: string }; // not accepted and not extractable → warn

/** Lowercased extension after the last dot, or "" if there is none. */
function fileExt(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot + 1).toLowerCase();
}

/**
 * Decide what to do with a file just placed in `alias`'s ROM folder. Pure — no
 * I/O. Callers apply it only for Batocera ROM placement. An alias with no
 * catalog entry, or a file whose extension the system already accepts, yields
 * `keep`, so missing data never risks corrupting a romset.
 */
export function planPostDownload(alias: string, filename: string): PostDownloadPlan {
  const accepted = acceptedExtensions(alias);
  const ext = fileExt(filename);
  if (accepted.length === 0) return { kind: "keep" };
  if (ext === "" || accepted.includes(ext)) return { kind: "keep" };
  if ((EXTRACTABLE as readonly string[]).includes(ext)) {
    return { kind: "extract", archive: filename };
  }
  return { kind: "manual", ext };
}
```

Add to `packages/core/src/index.ts` (extend the line added in Task 1):

```ts
export {
  SYSTEM_EXTENSIONS,
  acceptedExtensions,
  EXTRACTABLE,
  planPostDownload,
} from "./extensions.js";
export type { PostDownloadPlan } from "./extensions.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/test/extensions.test.ts`
Expected: PASS (all `SYSTEM_EXTENSIONS` + `planPostDownload` tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/extensions.ts packages/core/src/index.ts packages/core/test/extensions.test.ts
git commit -m "feat(core): planPostDownload decides keep/extract/manual

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Extraction executor (CLI)

**Files:**
- Create: `apps/cli/src/extract.ts`
- Test: `apps/cli/test/extract.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure I/O module).
- Produces:
  - `interface ExtractDeps { run?: (cmd: string, args: string[]) => Promise<{ code: number }>; unlink?: (p: string) => Promise<void>; mkdir?: (p: string) => Promise<void>; }`
  - `interface ExtractResult { ok: boolean; dir: string; }`
  - `extractArchive(archivePath: string, deps?: ExtractDeps): Promise<ExtractResult>`

Behavior: destination subfolder = the archive's directory + its basename minus the final extension (`/userdata/roms/psx/Some Game.zip` → `/userdata/roms/psx/Some Game/`). `mkdir -p` the subfolder, run `7z x -o<dir> -y <archive>`. On `code === 0` → `unlink` the archive, return `{ ok: true, dir }`. Otherwise warn to stderr, keep the archive, return `{ ok: false, dir }`. Never throws.

The default `run` spawns `7z` with `stdio: "ignore"`, resolves `{ code }` on `close`, and resolves `{ code: -1 }` on the `error` event (missing binary) so it flows through the same warn-and-keep path.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/extract.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/cli/test/extract.test.ts`
Expected: FAIL — cannot resolve `../src/extract.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/cli/src/extract.ts`:

```ts
import { spawn } from "node:child_process";
import { mkdir as fsMkdir, unlink as fsUnlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Injected I/O so tests never spawn a real process or touch disk. */
export interface ExtractDeps {
  run?: (cmd: string, args: string[]) => Promise<{ code: number }>;
  unlink?: (p: string) => Promise<void>;
  mkdir?: (p: string) => Promise<void>;
}

export interface ExtractResult {
  ok: boolean;
  /** The subfolder the archive was (or would be) extracted into. */
  dir: string;
}

/** Default runner: spawn 7z; a missing binary resolves to code -1, not a throw. */
function defaultRun(cmd: string, args: string[]): Promise<{ code: number }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", () => resolve({ code: -1 }));
    child.on("close", (code) => resolve({ code: code ?? -1 }));
  });
}

/** Basename minus the final extension: "Some Game.zip" → "Some Game". */
function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

/**
 * Extract `archivePath` into a sibling subfolder named after it using 7z, then
 * unlink the archive ONLY on exit 0. Best-effort: a missing binary or non-zero
 * exit warns to stderr, keeps the archive, and resolves ok:false. Never throws.
 */
export async function extractArchive(
  archivePath: string,
  deps: ExtractDeps = {},
): Promise<ExtractResult> {
  const run = deps.run ?? defaultRun;
  const unlink = deps.unlink ?? fsUnlink;
  const mkdir = deps.mkdir ?? ((p: string) => fsMkdir(p, { recursive: true }).then(() => undefined));

  const dir = join(dirname(archivePath), stripExt(basename(archivePath)));
  await mkdir(dir);

  const { code } = await run("7z", ["x", `-o${dir}`, "-y", archivePath]);
  if (code !== 0) {
    process.stderr.write(
      `roomba: could not extract ${basename(archivePath)} (leaving the archive in place)\n`,
    );
    return { ok: false, dir };
  }

  await unlink(archivePath);
  return { ok: true, dir };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/cli/test/extract.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/extract.ts apps/cli/test/extract.test.ts
git commit -m "feat(cli): 7z extraction executor with injectable runner

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire extraction into the download flow (CLI)

**Files:**
- Modify: `apps/cli/src/download.ts`
- Test: `apps/cli/test/download.test.ts`

**Interfaces:**
- Consumes: `planPostDownload`, `PostDownloadPlan` (core, Task 2); `extractArchive` (Task 3); existing `Destination`, `romsDir`, `maybeRefresh`.
- Produces (exported for testing):
  - `resolvePostDownload(destination: Destination, finalName: string): PostDownloadPlan` — pure. Returns `{ kind: "keep" }` for non-`roms` destinations; otherwise delegates to `planPostDownload(destination.alias, finalName)`.

- [ ] **Step 1: Write the failing test**

Add to the imports at the top of `apps/cli/test/download.test.ts`:

```ts
import { resolvePostDownload } from "../src/download.js";
```

Append this describe block:

```ts
describe("resolvePostDownload", () => {
  it("keeps files for a non-roms destination regardless of extension", () => {
    expect(resolvePostDownload({ kind: "path" }, "Some Game.zip")).toEqual({ kind: "keep" });
  });

  it("extracts a non-accepted archive placed in a roms folder", () => {
    expect(resolvePostDownload({ kind: "roms", alias: "psx" }, "Some Game.zip")).toEqual({
      kind: "extract",
      archive: "Some Game.zip",
    });
  });

  it("keeps an accepted archive placed in a roms folder", () => {
    expect(resolvePostDownload({ kind: "roms", alias: "snes" }, "Game.zip")).toEqual({
      kind: "keep",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/cli/test/download.test.ts`
Expected: FAIL — `resolvePostDownload` is not exported from `../src/download.js`.

- [ ] **Step 3: Write the implementation**

In `apps/cli/src/download.ts`:

1. Extend the core import (currently `import { CONSOLE_BY_ALIAS } from "@praser/roomba-core";`):

```ts
import { CONSOLE_BY_ALIAS, planPostDownload } from "@praser/roomba-core";
import type { DownloadRequest, PostDownloadPlan, RoomSource } from "@praser/roomba-core";
```

2. Add the executor import next to the batocera import:

```ts
import { extractArchive } from "./extract.js";
```

3. Add the pure decision helper (place it just above `maybeRefresh`):

```ts
/**
 * The post-download plan for a placement: `keep` for anything not going into a
 * ROM folder, otherwise the catalog's decision for the alias + final filename.
 * Pure — the actual extraction happens in `afterPlacement`.
 */
export function resolvePostDownload(
  destination: Destination,
  finalName: string,
): PostDownloadPlan {
  if (destination.kind !== "roms") return { kind: "keep" };
  return planPostDownload(destination.alias, finalName);
}
```

4. Add `afterPlacement`, which runs the plan then refreshes:

```ts
/** Post-placement work for a ROM: extract when needed, then refresh the library. */
async function afterPlacement(
  destination: Destination,
  finalDest: string,
  options: DownloadOptions,
): Promise<void> {
  const plan = resolvePostDownload(destination, basename(finalDest));
  if (plan.kind === "extract") {
    const result = await extractArchive(finalDest);
    if (result.ok) console.log(`Extracted to ${result.dir}/`);
  } else if (plan.kind === "manual" && destination.kind === "roms") {
    process.stderr.write(
      `roomba: ${destination.alias} doesn't accept .${plan.ext}; ` +
        `unpack it manually in ${romsDir(destination.alias)}\n`,
    );
  }
  await maybeRefresh(destination, options.noRefresh);
}
```

5. Replace **both** `await maybeRefresh(destination, options.noRefresh);` call
sites inside `downloadFile` (the `plan.action === "complete"` branch and the
normal end-of-stream path) with:

```ts
    await afterPlacement(destination, finalDest, options);
```

(`basename`, `romsDir`, `maybeRefresh`, and `finalDest` are all already in scope at both sites.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/cli/test/download.test.ts`
Expected: PASS, including the three new `resolvePostDownload` cases.

- [ ] **Step 5: Full build + suite**

Run: `pnpm build && pnpm test`
Expected: build succeeds; entire Vitest suite passes.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/download.ts apps/cli/test/download.test.ts
git commit -m "feat(cli): extract non-native archives after ROM placement

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (completed while writing)

- **Spec coverage:** catalog (Task 1); pure decision keep/extract/manual (Task 2); subfolder-per-archive layout + delete-on-success + best-effort (Task 3); wiring into both rename sites + non-roms skip + manual warning (Task 4); extractable = zip/7z/rar (Global Constraints + Task 2). Spec's "drift test asserts every alias has an entry" is honored via Task 1's coverage test, refined with a documented `UNMAPPED_ALIASES` allowlist (only `iortcw`, which the source dump didn't cover) — see Deviations.
- **Placeholder scan:** none. The only "paste here" is the real `SYSTEM_EXTENSIONS` data in Appendix A, reproduced in full below.
- **Type consistency:** `PostDownloadPlan` shape (`keep` / `extract{archive}` / `manual{ext}`), `ExtractResult` (`{ ok, dir }`), and `resolvePostDownload(Destination, string)` are used identically across Tasks 2–4.

### Deviation from spec

The spec's drift test "asserts every `CONSOLES` alias has an entry." Task 1 keeps that as a coverage test but allows a documented `UNMAPPED_ALIASES` set, and `planPostDownload` returns `keep` for any unmapped alias. This is strictly safer than failing hard or defaulting to extract (an unmapped system can never have its files touched) and lets the build stay green when authoritative `_info.txt` data is genuinely unavailable for an alias. Today that set is just `iortcw`.

---

## Appendix A — `SYSTEM_EXTENSIONS` data (paste into Task 1)

Sourced from each system's `_info.txt` "ROM files extensions accepted" line, normalized to lowercase without a leading dot. Order groups roughly by category for readability; order does not matter.

```ts
  // Arcade
  mame: ["zip", "7z"],
  fbneo: ["zip", "7z"],
  dice: ["zip", "dmy"],
  daphne: ["daphne", "squashfs"],
  singe: ["daphne", "squashfs"],
  namco22: ["zip", "7z"],
  namco2x6: ["zip"],
  model2: ["zip"],
  model3: ["zip"],
  naomi: ["lst", "bin", "dat", "zip", "7z"],
  naomi2: ["zip", "7z"],
  hikaru: ["zip", "7z"],
  gaelco: ["zip", "7z"],
  chihiro: ["iso"],
  triforce: ["iso", "rvz"],
  atomiswave: ["lst", "bin", "dat", "zip", "7z"],
  cave3rd: ["zip", "7z"],
  systemsp: ["lst", "bin", "dat", "zip", "7z"],
  lindbergh: ["game"],

  // Home consoles
  channelf: ["zip", "rom", "bin", "chf"],
  atari2600: ["a26", "bin", "zip", "7z"],
  odyssey2: ["bin", "zip", "7z"],
  astrocade: ["bin", "zip", "7z"],
  apfm1000: ["bin", "zip", "7z"],
  vc4000: ["bin", "rom", "pgm", "tvc", "zip", "7z"],
  intellivision: ["int", "bin", "rom", "zip", "7z"],
  sv8000: ["bin", "zip", "7z"],
  cassettevision: ["zip", "bin777"],
  atari5200: ["rom", "xfd", "atr", "atx", "cdm", "cas", "car", "bin", "a52", "xex", "zip", "7z"],
  colecovision: ["bin", "col", "rom", "zip", "7z"],
  advision: ["bin", "zip", "7z"],
  vectrex: ["bin", "gam", "vec", "zip", "7z"],
  crvision: ["bin", "rom", "zip", "7z"],
  arcadia: ["bin", "zip", "7z"],
  nes: ["nes", "unif", "unf", "zip", "7z"],
  sg1000: ["bin", "sg", "zip", "7z"],
  multivision: ["bin", "sg", "zip", "7z"],
  videopacplus: ["bin", "zip", "7z"],
  pv1000: ["bin", "zip", "7z"],
  pv2000: ["bin", "cas", "zip", "7z"],
  ctvboy: ["bin", "zip", "7z"],
  scv: ["bin", "zip", "0"],
  mastersystem: ["bin", "sms", "zip", "7z"],
  fds: ["fds", "zip", "7z"],
  atari7800: ["a78", "bin", "zip", "7z"],
  socrates: ["bin", "zip", "7z"],
  pcengine: ["pce", "bin", "zip", "7z"],
  megadrive: ["bin", "gen", "md", "sg", "smd", "zip", "7z"],
  pcenginecd: ["pce", "cue", "ccd", "iso", "img", "chd"],
  supergrafx: ["pce", "sgx", "cue", "ccd", "chd", "zip", "7z"],
  snes: ["smc", "fig", "sfc", "gd3", "gd7", "dx2", "bsx", "swc", "zip", "7z"],
  neogeo: ["7z", "zip"],
  cdi: ["chd", "cue", "toc", "nrg", "gdi", "iso", "cdr"],
  amigacdtv: ["bin", "cue", "iso", "chd", "m3u"],
  gx4000: ["dsk", "m3u", "cpr", "zip", "7z"],
  megacd: ["cue", "iso", "chd", "m3u"],
  "snes-msu1": ["smc", "sfc", "squashfs"],
  pico: ["bin", "md", "zip", "7z"],
  sgb: ["gb", "gbc", "zip", "7z"],
  supracan: ["bin", "zip", "7z"],
  "megadrive-msu": ["md", "zip", "7z", "squashfs"],
  "sgb-msu1": ["gb", "gbc", "zip", "7z", "squashfs"],
  jaguar: ["j64", "jag", "cof", "abs", "rom", "zip", "7z"],
  "3do": ["iso", "chd", "cue"],
  amigacd32: ["bin", "cue", "iso", "chd"],
  sega32x: ["32x", "chd", "smd", "bin", "md", "zip", "7z"],
  saturn: ["cue", "ccd", "m3u", "chd", "iso", "zip", "mds"],
  vis: ["chd", "cue", "toc", "nrg", "gdi", "iso", "cdr"],
  beena: ["bin", "zip", "7z"],
  gamate: ["bin", "zip", "7z"],
  gmaster: ["bin", "zip", "7z"],
  gamepock: ["bin", "zip", "7z"],
  supervision: ["sv", "zip", "7z"],
  megaduck: ["bin", "zip", "7z"],
  rx78: ["bin", "zip", "7z"],
  loopy: ["bin", "ic1", "zip", "7z"],
  vsmile: ["u1", "u3", "bin", "zip", "7z"],
  segaai: ["bin", "wav", "flac", "cas", "zip", "7z"],

  // Disc & modern consoles
  psx: ["cue", "img", "mdf", "pbp", "toc", "cbn", "m3u", "ccd", "chd", "iso"],
  ps2: ["iso", "mdf", "nrg", "bin", "img", "dump", "gz", "cso", "chd", "m3u"],
  ps3: ["ps3", "psn", "iso", "squashfs"],
  ps4: ["ps4"],
  psp: ["iso", "cso", "pbp", "chd"],
  psvita: ["zip", "psvita"],
  dreamcast: ["cdi", "cue", "gdi", "chd", "m3u"],
  neogeocd: ["cue", "iso", "chd"],
  pcfx: ["cue", "ccd", "toc", "chd", "zip", "7z", "m3u"],
  jaguarcd: ["cue", "cdi", "bigpimg"],
  n64: ["z64", "n64", "v64", "zip", "7z"],
  n64dd: ["z64", "n64", "ndd", "zip", "7z"],
  nds: ["nds", "bin", "zip", "7z"],
  "3ds": ["3ds", "cci", "cxi", "cia", "axf", "elf", "app", "squashfs", "zcci", "zcia", "zcxi"],
  gamecube: ["gcm", "iso", "gcz", "ciso", "wbfs", "rvz", "elf", "dol", "m3u", "json"],
  wii: ["gcm", "iso", "gcz", "ciso", "wbfs", "wad", "rvz", "elf", "dol", "m3u", "json"],
  wiiu: ["wua", "wup", "wud", "wux", "rpx", "squashfs", "wuhb"],
  xbox: ["iso", "squashfs"],
  xbox360: ["iso", "xex", "xbox360", "zar"],

  // Handhelds
  gb: ["gb", "zip", "7z"],
  gbc: ["gbc", "zip", "7z"],
  gba: ["gba", "zip", "7z"],
  gb2players: ["gb", "gb2", "gbc2", "zip", "7z"],
  gbc2players: ["gbc", "gb2", "gbc2", "zip", "7z"],
  gamegear: ["bin", "gg", "zip", "7z"],
  gamecom: ["bin", "tgc", "zip", "7z"],
  lynx: ["bll", "lnx", "lyx", "o", "zip", "7z"],
  ngp: ["ngp", "zip", "7z"],
  ngpc: ["ngc", "zip", "7z"],
  wswan: ["ws", "zip", "7z"],
  wswanc: ["wsc", "zip", "7z"],
  virtualboy: ["vb", "zip", "7z"],
  pokemini: ["min", "zip", "7z"],
  gp32: ["smc", "zip", "7z"],
  gameandwatch: ["mgw", "zip", "7z"],
  lcdgames: ["mgw", "zip", "7z"],

  // Home computers
  amiga500: ["adf", "uae", "ipf", "dms", "dmz", "adz", "lha", "hdf", "exe", "m3u", "zip", "raw", "scp"],
  amiga1200: ["adf", "uae", "ipf", "dms", "dmz", "adz", "lha", "hdf", "exe", "m3u", "zip", "raw", "scp"],
  amstradcpc: ["dsk", "sna", "tap", "cdt", "voc", "m3u", "zip", "7z"],
  apple2: ["nib", "do", "po", "dsk", "mfi", "dfi", "rti", "edd", "woz", "wav", "zip", "7z", "chd", "hdv", "2mg"],
  apple2gs: ["2mg", "do", "nib", "po", "dsk"],
  atari800: ["rom", "xfd", "atr", "atx", "cdm", "cas", "car", "bin", "a52", "xex", "zip", "7z", "m3u"],
  atarist: ["st", "msa", "stx", "dim", "ipf", "m3u", "zip", "7z", "hd", "gemdos"],
  xegs: ["atr", "dsk", "xfd", "bin", "rom", "car", "zip", "7z"],
  bbcmicro: ["mfi", "dfi", "hfe", "mfm", "td0", "imd", "d77", "d88", "1dd", "cqm", "cqi", "dsk", "ima", "img", "ufi", "360", "ipf", "ssd", "bbc", "dsd", "adf", "ads", "adm", "adl", "fsd", "wav", "tap", "bin", "zip", "7z"],
  electron: ["wav", "csw", "uef", "mfi", "dfi", "hfe", "mfm", "td0", "imd", "d77", "d88", "1dd", "cqm", "cqi", "dsk", "ssd", "bbc", "img", "dsd", "adf", "ads", "adm", "adl", "rom", "bin", "zip", "7z"],
  atom: ["wav", "tap", "csw", "uef", "mfi", "dfi", "hfe", "mfm", "td0", "imd", "d77", "d88", "1dd", "cqm", "cqi", "dsk", "40t", "atm", "bin", "rom", "zip", "7z"],
  archimedes: ["mfi", "dfi", "hfe", "mfm", "td0", "imd", "d77", "d88", "1dd", "cqm", "cqi", "dsk", "ima", "img", "ufi", "360", "ipf", "adf", "apd", "jfd", "ads", "adm", "adl", "ssd", "bbc", "dsd", "st", "msa", "chd", "zip", "7z"],
  c64: ["d64", "d71", "d81", "crt", "prg", "tap", "t64", "m3u", "zip", "7z", "nib", "g64"],
  c128: ["d64", "d81", "prg", "lnx", "m3u", "zip", "7z"],
  c20: ["20", "40", "60", "rom", "a0", "b0", "crt", "d64", "d81", "prg", "tap", "t64", "m3u", "zip", "7z"],
  cplus4: ["d64", "prg", "tap", "m3u", "zip", "7z"],
  pet: ["a0", "b0", "crt", "d64", "d81", "prg", "tap", "t64", "m3u", "zip", "7z"],
  commanderx16: ["bas", "img", "prg"],
  dragon64: ["wav", "cas", "dsk", "dmk", "ccc", "rom", "bin", "zip", "7z"],
  coco: ["wav", "cas", "dsk", "ccc", "rom", "zip", "7z"],
  camplynx: ["wav", "tap", "ldf", "zip", "7z"],
  cgenie: ["cas", "wav", "zip", "7z"],
  enterprise: ["bas", "com", "zip", "img", "dsk", "tap", "dtf", "trn", "128", "cas", "cdt", "tzx"],
  laser310: ["vz", "wav", "cas", "zip", "7z"],
  mc10: ["wav", "cas", "rom", "bin", "zip", "7z"],
  samcoupe: ["cpm", "dsk", "sad", "mgt", "sdf", "td0", "sbt", "zip"],
  spectravideo: ["zip", "7z", "cas"],
  trs80: ["cmd", "cas", "dsk", "dmk", "bas", "wav", "zip", "7z"],
  adam: ["wav", "ddp", "mfi", "dfi", "hfe", "mfm", "td0", "imd", "d77", "d88", "1dd", "cqm", "cqi", "dsk", "rom", "col", "bin", "zip", "7z"],
  tutor: ["bin", "wav", "zip", "7z"],
  ti99: ["rpk", "wav", "zip", "7z"],
  pcw: ["mfi", "dfi", "mfm", "td0", "imd", "86f", "d77", "d88", "1dd", "cqm", "cqi", "dsk", "zip", "7z"],
  bk: ["bin", "img", "dsk", "bkd", "zip", "7z"],
  msx1: ["dsk", "mx1", "rom", "zip", "7z", "cas", "m3u", "ogv", "openmsx"],
  msx2: ["dsk", "mx2", "rom", "zip", "7z", "cas", "m3u", "ogv", "openmsx"],
  "msx2+": ["dsk", "mx2", "rom", "zip", "7z", "cas", "m3u", "openmsx"],
  msxturbor: ["dsk", "mx2", "rom", "zip", "7z", "openmsx", "m3u"],
  zxspectrum: ["tzx", "tap", "z80", "rzx", "scl", "trd", "dsk", "zip", "7z"],
  zx81: ["tzx", "p", "zip", "7z"],
  oricatmos: ["tap", "dsk", "zip"],
  thomson: ["fd", "sap", "k7", "m7", "m5", "rom", "zip"],
  tvc: ["cas", "tap", "dsk", "img", "zip"],
  fm7: ["wav", "t77", "mfi", "dfi", "hfe", "mfm", "td0", "imd", "d77", "d88", "1dd", "cqm", "cqi", "dsk", "zip", "7z"],
  fmtowns: ["bin", "m3u", "cue", "d88", "d77", "xdf", "iso", "chd", "toc", "nrg", "gdi", "cdr", "mfi", "dfi", "hfe", "mfm", "td0", "imd", "1dd", "cqm", "cqi", "dsk", "zip", "7z"],
  pc60: ["bin", "cas", "p6", "d77", "d88", "dsk", "1dd", "mfi", "dfi", "mfm", "td0", "imd", "cqm", "cqi", "xdf", "hdm", "2hd", "fdi", "zip", "7z"],
  pc80: ["d77", "d88", "1dd", "dsk", "n80", "bin", "zip", "7z"],
  pc88: ["cmt", "d88", "u88", "m3u"],
  pc98: ["d98", "zip", "98d", "fdi", "fdd", "2hd", "tfd", "d88", "88d", "hdm", "xdf", "dup", "cmd", "hdi", "thd", "nhd", "hdd", "hdn", "m3u"],
  x1: ["dx1", "zip", "2d", "2hd", "tfd", "d88", "88d", "hdm", "xdf", "dup", "cmd", "7z"],
  x68000: ["dim", "img", "d88", "88d", "hdm", "dup", "2hd", "xdf", "hdf", "cmd", "m3u", "zip", "7z"],
  mz80k: ["mzf", "mzt", "m12", "wav", "zip", "7z"],
  mz700: ["mzf", "mzt", "m12", "wav", "zip", "7z"],
  mz800: ["mzf", "mzt", "m12", "wav", "zip", "7z"],
  mz2000: ["mzf", "mzt", "m12", "wav", "d88", "dsk", "zip", "7z"],
  mz2500: ["d88", "dsk", "mfi", "dfi", "hfe", "mfm", "td0", "imd", "d77", "1dd", "cqm", "cqi", "zip", "7z"],
  macintosh: ["dsk", "zip", "7z", "mfi", "dfi", "hfe", "mfm", "td0", "imd", "d77", "d88", "1dd", "cqm", "cqi", "ima", "img", "ufi", "ipf", "dc42", "woz", "2mg", "360", "chd", "cue", "toc", "nrg", "gdi", "iso", "cdr", "hd", "hdv", "hdi"],
  pdp1: ["zip", "7z", "tap", "rim", "drm"],

  // Fantasy / engine consoles & other cartridge systems
  arduboy: ["hex", "zip", "7z"],
  uzebox: ["uze", "bin", "zip"],
  vircon32: ["v32", "zip"],
  wasm4: ["wasm"],
  lowresnx: ["nx", "zip", "7z"],
  pico8: ["p8", "png", "m3u"],
  tic80: ["tic"],
  pyxel: ["py", "pyxapp"],
  lutro: ["lutro", "zip", "7z"],
  vgmplay: ["vgm", "vgz", "zip", "7z"],
  sufami: ["st", "fig", "bs", "smc", "sfc", "zip", "7z"],
  satellaview: ["bs", "smc", "sfc", "zip", "7z", "squashfs"],
  sc3000: ["bin", "sg", "wav", "cas", "bit", "zip", "7z"],
  flash: ["swf"],
  tvgames: ["zip", "7z"],
  openbor: ["pak"],
  solarus: ["zip", "solarus"],
  sonicretro: ["son", "scd"],
  ikemen: ["ikemen", "pc"],
  mugen: ["pc"],
  bennugd: ["dcb", "dat"],

  // Ports & standalone engines
  abuse: ["game"],
  catacomb: ["game"],
  cdogs: ["game"],
  corsixth: ["game"],
  halflife: ["game"],
  hcl: ["game"],
  hurrican: ["game"],
  jazz2: ["game"],
  openjazz: ["game"],
  superbroswar: ["game"],
  tyrian: ["game"],
  bstone: ["bstone"],
  cannonball: ["cannonball"],
  cavestory: ["exe"],
  cgenius: ["cgenius"],
  devilutionx: ["mpq"],
  doom3: ["d3"],
  "dxx-rebirth": ["d1x", "d2x"],
  ecwolf: ["ecwolf", "pk3", "squashfs"],
  eduke32: ["eduke32"],
  etlegacy: ["etl"],
  "fallout1-ce": ["f1ce"],
  "fallout2-ce": ["f2ce"],
  fury: ["grp"],
  gzdoom: ["wad", "iwad", "pwad", "gzdoom"],
  jknight: ["jedi"],
  jkdf2: ["jedi"],
  mohaa: ["mohaa"],
  moonlight: ["moonlight"],
  mrboom: ["libretro"],
  prboom: ["wad", "iwad", "pwad"],
  quake: ["quake"],
  quake2: ["quake2", "zip", "7zip"],
  quake3: ["quake3"],
  raze: ["raze"],
  reminiscence: ["rem"],
  rott: ["rott"],
  rtcw: ["rtcw"],
  scummvm: ["scummvm", "squashfs"],
  sdlpop: ["sdlpop"],
  "sonic-mania": ["sman"],
  "sonic3-air": ["s3air"],
  theforceengine: ["tfe"],
  thextech: ["smbx", "squashfs"],
  traider1: ["croft"],
  traider2: ["croft"],
  zc210: ["qst"],
  vpinball: ["vpx"],
  easyrpg: ["easyrpg", "squashfs", "zip"],
  dos: ["pc", "dos", "zip", "squashfs", "dosz", "m3u", "iso", "cue"],
  windows: ["pc", "exe", "wine", "wsquashfs", "wtgz"],
  windows_installers: ["exe", "iso", "msi"],
  steam: ["steam"],
  flatpak: ["flatpak"],
  ports: ["sh", "squashfs"],
  xrick: ["zip"],
```

**Syntax reminder when pasting:** every hyphenated alias is a quoted key (`"dxx-rebirth"`, `"snes-msu1"`, `"sgb-msu1"`, `"megadrive-msu"`, `"fallout1-ce"`, `"fallout2-ce"`, `"sonic-mania"`, `"sonic3-air"`), and `"3do"` / `"3ds"` / `"msx2+"` are quoted too — a bare `3do:` or `dxx-rebirth:` won't parse. The orphan/coverage tests in Task 1 catch any typo or omission.

The following catalog aliases are intentionally **absent** (no authoritative extension data in the source dump) and fall through to `keep`: `iortcw`. Keep it in `UNMAPPED_ALIASES`.
