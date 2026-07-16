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
