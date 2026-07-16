import { describe, expect, it, vi } from "vitest";
import { runPostDownloadHook } from "../src/hooks.js";

function harness(exists: boolean, code = 0) {
  const calls: Array<{
    cmd: string;
    args: string[];
    opts: { cwd: string; env: NodeJS.ProcessEnv };
  }> = [];
  const run = vi.fn(
    async (cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => {
      calls.push({ cmd, args, opts });
      return { code };
    },
  );
  return { calls, run, deps: { run, exists: () => exists } };
}

describe("runPostDownloadHook", () => {
  it("runs sh with the basename, cwd, and ROOMBA_* env when the hook exists", async () => {
    const h = harness(true, 0);
    await runPostDownloadHook(
      "/userdata/roms/psx",
      "/userdata/roms/psx/Some Game.iso",
      "https://x/y",
      h.deps,
    );

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
    await runPostDownloadHook(
      "/userdata/roms/psx",
      "/userdata/roms/psx/Game.iso",
      "https://x/y",
      h.deps,
    );
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
