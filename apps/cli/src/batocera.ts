import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Paths detection reads; overridable so tests point at fixtures. */
export interface DetectDeps {
  /** os-release file (default "/etc/os-release"). */
  osReleasePath?: string;
  /** ROM root that must exist (default "/userdata/roms"). */
  romsPath?: string;
}

/**
 * True when running on a Batocera system: os-release mentions "batocera"
 * (case-insensitive) AND the ROM root exists. Requiring both avoids false
 * positives on a dev box that merely has an /userdata directory.
 */
export function detectBatocera(deps: DetectDeps = {}): boolean {
  const osReleasePath = deps.osReleasePath ?? "/etc/os-release";
  const romsPath = deps.romsPath ?? "/userdata/roms";
  let osRelease: string;
  try {
    osRelease = readFileSync(osReleasePath, "utf8");
  } catch {
    return false;
  }
  return /batocera/i.test(osRelease) && existsSync(romsPath);
}

/** Absolute ROM folder for a catalog alias: /userdata/roms/<alias>. */
export function romsDir(alias: string): string {
  return join("/userdata/roms", alias);
}

/**
 * Best-effort library refresh so a newly-placed ROM appears without a reboot.
 * Restarts EmulationStation via batocera-es-swissknife. Never throws: if the
 * binary is missing or exits non-zero, warn and return — the ROM is in place.
 */
export function refreshLibrary(): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn("batocera-es-swissknife", ["--restart"], { stdio: "ignore" });
    child.on("error", () => {
      process.stderr.write(
        "roomba: could not refresh EmulationStation (restart it to see the game)\n",
      );
      resolve();
    });
    child.on("close", () => resolve());
  });
}
