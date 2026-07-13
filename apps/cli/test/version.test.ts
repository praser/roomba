import { describe, expect, it } from "vitest";
import { formatVersions } from "../src/version.js";

describe("formatVersions", () => {
  it("lists cli, core, and each installed engine", () => {
    const out = formatVersions({
      cli: "2.0.1",
      core: "1.1.1",
      engines: [
        { id: "vimm", version: "1.0.0" },
        { id: "example", version: "0.3.2" },
      ],
    });
    expect(out).toBe(
      [
        "@praser/roomba 2.0.1",
        "@praser/roomba-core 1.1.1",
        "engines:",
        "  vimm 1.0.0",
        "  example 0.3.2",
      ].join("\n"),
    );
  });

  it("reports when no engines are installed", () => {
    const out = formatVersions({ cli: "2.0.1", core: "1.1.1", engines: [] });
    expect(out).toContain("engines: (none installed)");
  });
});
