import { describe, expect, it, vi } from "vitest";
import { updateCli, type Updater } from "../src/self-update.js";

describe("updateCli", () => {
  it("installs @latest when the current version is behind", async () => {
    const install = vi.fn(async () => {});
    const updater: Updater = { latest: async () => "2.1.0\n", install };
    const logs: string[] = [];

    await updateCli("@praser/roomba", "2.0.0", updater, (m) => logs.push(m));

    expect(install).toHaveBeenCalledWith("@praser/roomba@latest");
    expect(logs.join("\n")).toContain("2.0.0 → 2.1.0");
  });

  it("does nothing when already up to date", async () => {
    const install = vi.fn(async () => {});
    const updater: Updater = { latest: async () => "2.0.0", install };
    const logs: string[] = [];

    await updateCli("@praser/roomba", "2.0.0", updater, (m) => logs.push(m));

    expect(install).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("already up to date");
  });

  it("throws when the latest version cannot be determined", async () => {
    const updater: Updater = { latest: async () => "", install: vi.fn() };
    await expect(updateCli("@praser/roomba", "2.0.0", updater)).rejects.toThrow(
      /latest version/,
    );
  });
});
