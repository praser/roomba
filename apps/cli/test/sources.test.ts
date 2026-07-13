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
