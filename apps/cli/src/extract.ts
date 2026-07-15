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
  const mkdir =
    deps.mkdir ?? ((p: string) => fsMkdir(p, { recursive: true }).then(() => undefined));

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
