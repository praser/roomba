/** Render a simple pipe-separated, column-aligned table. */
export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, col) =>
    Math.max(header.length, ...rows.map((row) => (row[col] ?? "").length)),
  );
  const format = (cells: string[]) =>
    cells.map((cell, col) => cell.padEnd(widths[col]!)).join(" | ");
  return [format(headers), ...rows.map(format)].join("\n");
}
