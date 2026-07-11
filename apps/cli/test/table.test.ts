import { describe, expect, it } from "vitest";
import { renderTable } from "../src/table.js";

describe("renderTable", () => {
  it("pads every column to the widest cell, including the header", () => {
    const output = renderTable(
      ["A", "Bee"],
      [
        ["xx", "y"],
        ["z", "wwww"],
      ],
    );
    expect(output.split("\n")).toEqual([
      "A  | Bee ",
      "xx | y   ",
      "z  | wwww",
    ]);
  });

  it("renders just the header when there are no rows", () => {
    expect(renderTable(["One", "Two"], [])).toBe("One | Two");
  });
});
