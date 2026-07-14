import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectBatocera, romsDir } from "../src/batocera.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "roomba-bato-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("romsDir", () => {
  it("joins the alias under /userdata/roms", () => {
    expect(romsDir("snes")).toBe("/userdata/roms/snes");
    expect(romsDir("msx2+")).toBe("/userdata/roms/msx2+");
  });
});

describe("detectBatocera", () => {
  it("is true only when os-release names batocera AND the roms path exists", async () => {
    const osRelease = join(dir, "os-release");
    const roms = join(dir, "roms");
    await writeFile(osRelease, 'NAME="batocera"\nID=batocera\n');
    await rm(roms, { recursive: true, force: true });
    // os-release matches but roms path missing → false
    expect(detectBatocera({ osReleasePath: osRelease, romsPath: roms })).toBe(false);
  });

  it("is true when both signals are present", async () => {
    const osRelease = join(dir, "os-release");
    await writeFile(osRelease, 'PRETTY_NAME="Batocera 40"\nID=batocera\n');
    expect(detectBatocera({ osReleasePath: osRelease, romsPath: dir })).toBe(true);
  });

  it("is false when os-release does not mention batocera", async () => {
    const osRelease = join(dir, "os-release");
    await writeFile(osRelease, 'NAME="Ubuntu"\nID=ubuntu\n');
    expect(detectBatocera({ osReleasePath: osRelease, romsPath: dir })).toBe(false);
  });

  it("is false when os-release is missing", () => {
    expect(detectBatocera({ osReleasePath: join(dir, "nope"), romsPath: dir })).toBe(false);
  });
});
