# Post-download Hook + Remove Batocera Auto-placement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace roomba's built-in per-system post-download behavior with a generic `roomba.post-download.sh` user hook, remove all Batocera console auto-recognition / ROM-folder placement (and the archive-extraction feature added earlier on this branch), and ship the breaking change as proper semver majors.

**Architecture:** roomba becomes a plain downloader again — save to `~/Downloads` (or `--output`), then, if a `roomba.post-download.sh` exists in the destination folder, run it via `sh`. All system-specific work moves into that user script. The hook lives in a small injectable CLI module; the `Destination`/placement machinery and the `consoleFor` engine method are deleted.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node ≥ 22, Vitest, pnpm workspaces. Hook invoked with `sh` (Batocera/Linux target).

## Global Constraints

- **ESM import specifiers end in `.js`** even for `.ts` sources.
- **`roomba-core` stays I/O-free** (pure data + types).
- **Hook contract:** `sh <hookpath> <basename>`, CWD = destination folder, env adds `ROOMBA_FILE` (absolute path), `ROOMBA_FILENAME` (basename), `ROOMBA_URL`.
- **Best-effort hook:** non-zero exit or missing `sh` warns to stderr; roomba exits 0. Never throws, never sets `process.exitCode`.
- **Tests run fully offline** — inject fakes; never spawn a real process.
- Run tests with `pnpm exec vitest run <path>` (a single file) or `pnpm test` (all). `pnpm build` = `tsc -b` across packages. **Vitest resolves `@praser/roomba-core` via its built `dist`, so run `pnpm build` before `pnpm test` after any core change.**
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

- `apps/cli/src/hooks.ts` **(create)** — `runPostDownloadHook` + `POST_DOWNLOAD_HOOK`.
- `apps/cli/test/hooks.test.ts` **(create)** — hook tests with injected `run`/`exists`.
- `apps/cli/src/download.ts` **(modify)** — drop placement machinery; wire the hook.
- `apps/cli/src/index.ts` **(modify)** — drop `--console`/`--no-refresh`; fix `-o` help.
- `apps/cli/test/download.test.ts` **(modify)** — drop Batocera/placement describe blocks; drop `consoleFor` from `fakeSource`.
- `packages/core/src/index.ts` **(modify)** — remove `consoleFor`; `ENGINE_API_VERSION = 3`.
- `packages/core/test/engine.test.ts` **(modify)** — 2→3; drop `consoleFor`.
- `apps/cli/test/engines.test.ts` **(modify)** — fixture default 2→3; drop `consoleFor` line.
- **Delete:** `apps/cli/src/batocera.ts`, `apps/cli/test/batocera.test.ts`, `apps/cli/src/extract.ts`, `apps/cli/test/extract.test.ts`, `packages/core/src/extensions.ts`, `packages/core/test/extensions.test.ts`.
- Version + docs: `package.json`, `apps/cli/package.json`, `packages/core/package.json`, `README.md`, `apps/cli/README.md`.

---

## Task 1: Revert the archive-extraction feature

Restores `download.ts`, core `index.ts`, and `download.test.ts` to their pre-extraction state (commit `d5fe164`, the branch point) and deletes the extraction-only files. After this task the branch behaves exactly as it did before the extraction feature (Batocera placement still present — removed in Task 3).

**Files:**
- Restore: `apps/cli/src/download.ts`, `packages/core/src/index.ts`, `apps/cli/test/download.test.ts`
- Delete: `packages/core/src/extensions.ts`, `packages/core/test/extensions.test.ts`, `apps/cli/src/extract.ts`, `apps/cli/test/extract.test.ts`

- [ ] **Step 1: Restore the three edited files to the branch point**

```bash
git checkout d5fe164 -- apps/cli/src/download.ts packages/core/src/index.ts apps/cli/test/download.test.ts
```

- [ ] **Step 2: Delete the extraction-only files**

```bash
git rm packages/core/src/extensions.ts packages/core/test/extensions.test.ts apps/cli/src/extract.ts apps/cli/test/extract.test.ts
```

- [ ] **Step 3: Build and run the full suite**

Run: `pnpm build && pnpm test`
Expected: build succeeds; all tests pass. `git grep -n "planPostDownload\|SYSTEM_EXTENSIONS\|extractArchive\|resolvePostDownload" apps packages` returns **nothing** (outside `dist/` and `docs/`).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "revert: drop built-in archive extraction

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Post-download hook module

**Files:**
- Create: `apps/cli/src/hooks.ts`
- Test: `apps/cli/test/hooks.test.ts`

**Interfaces:**
- Produces:
  - `POST_DOWNLOAD_HOOK = "roomba.post-download.sh"`
  - `interface HookDeps { run?: (cmd, args, opts: { cwd, env }) => Promise<{ code: number }>; exists?: (p: string) => boolean; }`
  - `runPostDownloadHook(dir: string, filePath: string, url: string, deps?: HookDeps): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/hooks.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runPostDownloadHook } from "../src/hooks.js";

function harness(exists: boolean, code = 0) {
  const calls: Array<{ cmd: string; args: string[]; opts: { cwd: string; env: NodeJS.ProcessEnv } }> = [];
  const run = vi.fn(async (cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => {
    calls.push({ cmd, args, opts });
    return { code };
  });
  return { calls, run, deps: { run, exists: () => exists } };
}

describe("runPostDownloadHook", () => {
  it("runs sh with the basename, cwd, and ROOMBA_* env when the hook exists", async () => {
    const h = harness(true, 0);
    await runPostDownloadHook("/userdata/roms/psx", "/userdata/roms/psx/Some Game.iso", "https://x/y", h.deps);

    expect(h.run).toHaveBeenCalledTimes(1);
    const { cmd, args, opts } = h.calls[0];
    expect(cmd).toBe("sh");
    expect(args).toEqual(["/userdata/roms/psx/roomba.post-download.sh", "Some Game.iso"]);
    expect(opts.cwd).toBe("/userdata/roms/psx");
    expect(opts.env.ROOMBA_FILE).toBe("/userdata/roms/psx/Some Game.iso");
    expect(opts.env.ROOMBA_FILENAME).toBe("Some Game.iso");
    expect(opts.env.ROOMBA_URL).toBe("https://x/y");
  });

  it("does not run anything when the hook is absent", async () => {
    const h = harness(false);
    await runPostDownloadHook("/userdata/roms/psx", "/userdata/roms/psx/Game.iso", "https://x/y", h.deps);
    expect(h.run).not.toHaveBeenCalled();
  });

  it("resolves without throwing when the hook exits non-zero", async () => {
    const h = harness(true, 3);
    await expect(
      runPostDownloadHook("/d", "/d/g.iso", "https://x/y", h.deps),
    ).resolves.toBeUndefined();
    expect(h.run).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/cli/test/hooks.test.ts`
Expected: FAIL — cannot resolve `../src/hooks.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/cli/src/hooks.ts`:

```ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/** Injected I/O so tests never spawn a real process or touch disk. */
export interface HookDeps {
  run?: (
    cmd: string,
    args: string[],
    opts: { cwd: string; env: NodeJS.ProcessEnv },
  ) => Promise<{ code: number }>;
  exists?: (p: string) => boolean;
}

/** The hook filename roomba looks for in the destination folder. */
export const POST_DOWNLOAD_HOOK = "roomba.post-download.sh";

/** Default runner: spawn with inherited stdio; missing binary → code -1. */
function defaultRun(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ code: number }> {
  return new Promise((res) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: "inherit" });
    child.on("error", () => res({ code: -1 }));
    child.on("close", (code) => res({ code: code ?? -1 }));
  });
}

/**
 * Run `<dir>/roomba.post-download.sh` if it exists: `sh <hook> <basename>` with
 * cwd=dir and ROOMBA_FILE / ROOMBA_FILENAME / ROOMBA_URL in the environment.
 * Best-effort — a non-zero exit or a missing `sh` warns to stderr and resolves;
 * never throws. No-op (silent) when the hook file is absent.
 */
export async function runPostDownloadHook(
  dir: string,
  filePath: string,
  url: string,
  deps: HookDeps = {},
): Promise<void> {
  const exists = deps.exists ?? existsSync;
  const run = deps.run ?? defaultRun;

  const hookPath = join(dir, POST_DOWNLOAD_HOOK);
  if (!exists(hookPath)) return;

  const absFile = resolve(filePath);
  const filename = basename(filePath);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ROOMBA_FILE: absFile,
    ROOMBA_FILENAME: filename,
    ROOMBA_URL: url,
  };

  const { code } = await run("sh", [hookPath, filename], { cwd: dir, env });
  if (code !== 0) {
    process.stderr.write(
      code === -1
        ? "roomba: could not run post-download hook (sh not found)\n"
        : `roomba: post-download hook exited ${code}\n`,
    );
  }
}
```

Note: the test passes absolute paths, so `resolve(filePath)` is idempotent and `ROOMBA_FILE` equals the input.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run apps/cli/test/hooks.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/hooks.ts apps/cli/test/hooks.test.ts
git commit -m "feat(cli): post-download hook runner (roomba.post-download.sh)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Remove Batocera placement; wire the hook into download

**Files:**
- Modify: `apps/cli/src/download.ts`, `apps/cli/src/index.ts`, `apps/cli/test/download.test.ts`
- Delete: `apps/cli/src/batocera.ts`, `apps/cli/test/batocera.test.ts`

**Interfaces:**
- Consumes: `runPostDownloadHook` (Task 2).
- `DownloadOptions` becomes `{ output?: string }`.

- [ ] **Step 1: Delete the Batocera module + test**

```bash
git rm apps/cli/src/batocera.ts apps/cli/test/batocera.test.ts
```

- [ ] **Step 2: Edit `apps/cli/src/download.ts`**

Replace the import header (lines 1–10) so it reads:

```ts
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DownloadRequest, RoomSource } from "@praser/roomba-core";
import { runPostDownloadHook } from "./hooks.js";
```

Replace `DownloadOptions` with:

```ts
export interface DownloadOptions {
  /** -o output file or directory (default: your Downloads folder). */
  output?: string;
}
```

Replace the `downloadFile` doc comment + the block from `const onBatocera = ...`
down through the `const { dir, fixedFile } = ...` assignment. The new body from
the top of `downloadFile` reads:

```ts
/**
 * Download a file, resuming a prior partial (`<dest>.part`) via an HTTP Range
 * request when one exists. Saves to your Downloads folder by default, or to
 * `-o`. After the file is saved, runs `roomba.post-download.sh` from the
 * destination folder if present. Ctrl-C pauses (the partial is kept); re-running
 * resumes.
 */
export async function downloadFile(
  sources: RoomSource[],
  rawUrl: string,
  options: DownloadOptions = {},
): Promise<void> {
  const url = new URL(rawUrl);

  const resolved = await resolveDownload(sources, url);
  if (!resolved) {
    throw new Error(`No source knows how to download ${url.href}`);
  }
  const { source, request } = resolved;

  // The .part path is derived from the URL/-o (not the response), so it's stable
  // across runs and a re-run finds it to resume.
  const { dir, fixedFile } = await targetDir(options.output);
```

(`source` stays destructured — it's used later by nothing? It is not used after this in the new flow; if TypeScript/eslint flags it as unused, change to `const { request } = resolved;`. Verify at Step 5.)

Replace **both** finalize sites — the `plan.action === "complete"` branch and the end-of-stream path — so each reads:

```ts
      await rename(partialPath, finalDest);
      console.log(`Saved to ${finalDest}`);
      await runPostDownloadHook(dir, finalDest, url.href);
      return;
```

and

```ts
    await rename(partialPath, finalDest);
    process.stderr.write("\n");
    console.log(`Saved to ${finalDest}`);
    await runPostDownloadHook(dir, finalDest, url.href);
```

Delete these now-unused declarations entirely: `maybeRefresh`, `ensureDir`,
`ROOMBA_CONSOLE_PARAM`, `resolveConsoleAlias`, the `Destination` type, the
`DestinationInput` interface, and `resolveDestination` (with their doc comments).

- [ ] **Step 3: Edit `apps/cli/src/index.ts` download command**

Replace the `.command("download")` block's options + action with:

```ts
program
  .command("download")
  .argument("<url>", "download URL from `roomba search`")
  .option(
    "-o, --output <path>",
    "output file or directory (default: your Downloads folder)",
  )
  .description("Download a game file")
  .action(async (url: string, options: { output?: string }) => {
    const sources = await createSources({ cache: false });
    if (sources.length === 0) return printNoEngines();
    await downloadFile(sources, url, { output: options.output });
  });
```

- [ ] **Step 4: Edit `apps/cli/test/download.test.ts`**

Remove `resolveConsoleAlias` and `resolveDestination` from the import block
(keep `resolveDownload`, `resolveFinalName`, `resumePlan`, etc.). Delete the two
describe blocks `describe("resolveDestination", …)` and
`describe("resolveConsoleAlias", …)` in full. Leave `fakeSource` as-is (its
`consoleFor` is removed in Task 4) and keep every other block.

- [ ] **Step 5: Build and run the suite**

Run: `pnpm build && pnpm test`
Expected: build succeeds; all tests pass. If `source` is reported unused in
`download.ts`, change `const { source, request } = resolved;` to
`const { request } = resolved;` and rebuild.
Also confirm: `git grep -n "detectBatocera\|refreshLibrary\|romsDir\|roomba_console\|Destination\|--console\|no-refresh" apps/cli/src` returns nothing.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(cli)!: remove Batocera auto-placement; run post-download hook

BREAKING CHANGE: downloads no longer auto-place into /userdata/roms or restart
EmulationStation. Files save to ~/Downloads (or -o). Post-download behavior is
now driven by a user roomba.post-download.sh hook. Removes --console and
--no-refresh.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Remove `consoleFor` from the engine contract; bump API version

**Files:**
- Modify: `packages/core/src/index.ts`, `packages/core/test/engine.test.ts`, `apps/cli/test/engines.test.ts`, `apps/cli/test/download.test.ts`

- [ ] **Step 1: Edit `packages/core/src/index.ts`**

Delete the `consoleFor` member (and its doc comment) from the `RoomSource`
interface — the block:

```ts
  /**
   * If this source recognizes the URL, return the catalog alias of the console
   * it belongs to (e.g. "snes"); otherwise null. May be async: an engine can
   * navigate intermediate pages (via its injected Fetcher) to determine it.
   */
  consoleFor: (url: URL) => Awaitable<string | null>;
```

Change the version constant:

```ts
export const ENGINE_API_VERSION = 3;
```

- [ ] **Step 2: Edit `packages/core/test/engine.test.ts`**

- Change the standalone assertion test title/body `"ENGINE_API_VERSION is 2"` →
  `"ENGINE_API_VERSION is 3"` and `expect(ENGINE_API_VERSION).toBe(2)` →
  `toBe(3)`.
- Rename the second test to `"a conforming RoomEngine constructs a RoomSource"`.
- In the `source` literal, delete the line
  `consoleFor: (url) => (url.searchParams.get("mediaId") ? "snes" : null),`.
- Delete the two `consoleFor` assertion lines and change the final
  `expect(engine.apiVersion).toBe(2);` → `toBe(3);`.

- [ ] **Step 3: Edit `apps/cli/test/engines.test.ts`**

- `function fixtureBundle(apiVersion = 2)` → `apiVersion = 3`.
- Delete the `consoleFor: () => null,` line inside the fixture bundle template.

- [ ] **Step 4: Edit `apps/cli/test/download.test.ts`**

In `fakeSource`, delete the line `consoleFor: () => null,`.

- [ ] **Step 5: Build and run the suite**

Run: `pnpm build && pnpm test`
Expected: build succeeds; all tests pass. `git grep -n "consoleFor" apps packages` (outside `dist/`) returns nothing.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core)!: remove consoleFor from RoomSource; ENGINE_API_VERSION 3

BREAKING CHANGE: RoomSource no longer has consoleFor and the engine API is now
version 3. Engines built for v2 are refused until rebuilt.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Version bumps + docs

**Files:**
- Modify: `package.json`, `apps/cli/package.json`, `packages/core/package.json`, `README.md`, `apps/cli/README.md`

- [ ] **Step 1: Bump versions**

- `package.json` (root): `"version": "2.0.0"` → `"3.0.0"`.
- `apps/cli/package.json`: `"version": "2.0.2"` → `"3.0.0"`.
- `packages/core/package.json`: `"version": "2.0.0"` → `"3.0.0"`.

- [ ] **Step 2: Update `README.md`**

- Command table row for `download`: change
  `` | `roomba download <url> [-o <path>] [-c <alias>] [--no-refresh]` | Download a game file (on Batocera, into the system's ROM folder) | ``
  to
  `` | `roomba download <url> [-o <path>]` | Download a game file to your Downloads folder (or `-o`); runs `roomba.post-download.sh` from the destination folder if present | ``
- In the intro download example, ensure no claim of ROM-folder placement remains
  (it saves to Downloads / `-o`).

- [ ] **Step 3: Update `apps/cli/README.md`**

- Heading `### roomba download <url> [-o <path>] [-c <alias>] [--no-refresh]` →
  `### roomba download <url> [-o <path>]`.
- Options table: change the `-o, --output` row description to
  "Output **file** (used as-is) or **directory** (server filename inside it).
  Defaults to your OS Downloads folder"; **delete** the `-c, --console` and
  `--no-refresh` rows.
- Replace the paragraph describing Batocera detection / ROM-folder placement /
  `--console` / `--no-refresh` with a short **Post-download hook** section:

  > After a file finishes downloading, if a `roomba.post-download.sh` script
  > exists in the destination folder, roomba runs it with `sh`. The script's
  > working directory is the destination folder; the downloaded file's name is
  > passed as `$1`, and `ROOMBA_FILE` (absolute path), `ROOMBA_FILENAME`, and
  > `ROOMBA_URL` are set in the environment. A non-zero exit is warned about but
  > does not fail the download.

- [ ] **Step 4: Verify docs have no stale references**

Run: `git grep -n "no-refresh\|--console\|EmulationStation\|/userdata/roms\|consoleFor" README.md apps/cli/README.md`
Expected: no matches. (`docs/writing-engines.md` contains no `consoleFor`
reference — verified — and its apiVersion examples are illustrative; leave it.)

- [ ] **Step 5: Final build + full suite**

Run: `pnpm build && pnpm test`
Expected: build succeeds; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: bump to 3.0.0 and update docs for the download hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (completed while writing)

- **Spec coverage:** hook module (Task 2) + wiring (Task 3); remove Batocera placement/detection/refresh/`roomba_console`/flags (Task 3); revert extraction (Task 1); remove `consoleFor` + `ENGINE_API_VERSION` bump (Task 4); version majors + docs (Task 5). Non-goals (pre-download hooks, structured metadata, per-system knowledge, Windows hooks) are not added.
- **Placeholder scan:** none. New module + tests are shown in full; edits give exact old/new snippets and grep-based verifications.
- **Type consistency:** `runPostDownloadHook(dir, filePath, url, deps?)` and `HookDeps.run(cmd, args, { cwd, env })` are identical across Task 2's impl, its test, and Task 3's call site (`runPostDownloadHook(dir, finalDest, url.href)`). `DownloadOptions` is `{ output?: string }` in both `download.ts` and `index.ts`.

### Deviation from spec

The spec listed `docs/writing-engines.md` among doc updates. It contains **no**
`consoleFor` reference (verified by grep) and its `apiVersion` numbers are
already illustrative rather than tracking the live value, so Task 5 leaves it
untouched to avoid churn. README and the CLI README (the user-facing behavior
docs) are updated.
