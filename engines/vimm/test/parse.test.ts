import { describe, expect, it } from "vitest";
import { parseSearchListings, parseVariations } from "../src/parse.js";

const b64 = (title: string): string => Buffer.from(title, "utf8").toString("base64");

interface MediaInput {
  id: number;
  title: string;
  version?: string;
  sortOrder?: number;
  sizes?: [string, string, string]; // [Zipped, AltZipped, AltZipped2]
}

function mediaScript(entries: MediaInput[]): string {
  const json = entries.map((entry) => {
    const [zipped, alt, alt2] = entry.sizes ?? ["100 MB", "0 KB", "0 KB"];
    return JSON.stringify({
      ID: entry.id,
      GoodTitle: b64(entry.title),
      Version: entry.version ?? "1.0",
      SortOrder: entry.sortOrder ?? 1,
      ZippedText: zipped,
      AltZippedText: alt,
      AltZipped2Text: alt2,
    });
  });
  return `<script>let media=[${json.join(",")}];</script>`;
}

const dlForm = (host: string): string =>
  `<form action="//${host}/" method="POST" id="dl_form"><input name="mediaId"></form>`;

const formatSelect = (labels: string[]): string =>
  `<select id="dl_format">${labels
    .map((label, i) => `<option value="${i}"${i === 0 ? ' title="x"' : ""}>${label}</option>`)
    .join("")}</select>`;

describe("parseSearchListings", () => {
  const html = `
    <table class="hovertable">
      <tr><th>Title</th><th>Region</th><th>Version</th><th>Languages</th><th>Rating</th></tr>
      <tr>
        <td><a href="/vault/999999"></a><a href="/vault/50813">Resident Evil 2</a></td>
        <td><img src="/f/eu.png" title="Europe"><img src="/f/us.png" title="USA"></td>
        <td>1.0</td><td>-</td>
        <td><a href="/vault/?p=rating&amp;id=50813">9.6</a></td>
      </tr>
      <tr>
        <td><a href="/vault/999999"></a><a href="/vault/6037">Resident Evil</a></td>
        <td><img src="/f/us.png" title="USA"></td>
        <td>1.1</td><td>en fr</td><td>8.1</td>
      </tr>
    </table>`;

  it("extracts one listing per game row, skipping the header", () => {
    const listings = parseSearchListings(html);
    expect(listings).toEqual([
      { id: "50813", title: "Resident Evil 2", region: "Europe, USA", languages: "-", rating: "9.6" },
      { id: "6037", title: "Resident Evil", region: "USA", languages: "en fr", rating: "8.1" },
    ]);
  });

  it("returns nothing for a page with no results table", () => {
    expect(parseSearchListings("<div>no games</div>")).toEqual([]);
  });
});

describe("parseVariations", () => {
  it("emits one row per disc (multi-media, single format)", () => {
    const html =
      dlForm("dl3.vimm.net") +
      mediaScript([
        { id: 44190, title: "Resident Evil 2 (Europe) (Disc 1)", sortOrder: 1, sizes: ["330 MB", "0 KB", "0 KB"] },
        { id: 44545, title: "Resident Evil 2 (Europe) (Disc 2)", sortOrder: 2, sizes: ["332 MB", "0 KB", "0 KB"] },
      ]);

    expect(parseVariations(html)).toEqual([
      { name: "Resident Evil 2 (Europe) (Disc 1)", version: "1.0", size: "330 MB", downloadUrl: "https://dl3.vimm.net/?mediaId=44190" },
      { name: "Resident Evil 2 (Europe) (Disc 2)", version: "1.0", size: "332 MB", downloadUrl: "https://dl3.vimm.net/?mediaId=44545" },
    ]);
  });

  it("emits one row per format with labels, sizes, and alt URLs", () => {
    const html =
      dlForm("dl2.vimm.net") +
      formatSelect([".ciso", ".nkit.iso", ".rvz"]) +
      mediaScript([{ id: 5082, title: "Zelda.iso", sizes: ["715 MB", "713 MB", "712 MB"] }]);

    expect(parseVariations(html)).toEqual([
      { name: "Zelda.iso [.ciso]", version: "1.0", size: "715 MB", downloadUrl: "https://dl2.vimm.net/?mediaId=5082" },
      { name: "Zelda.iso [.nkit.iso]", version: "1.0", size: "713 MB", downloadUrl: "https://dl2.vimm.net/?mediaId=5082&alt=1" },
      { name: "Zelda.iso [.rvz]", version: "1.0", size: "712 MB", downloadUrl: "https://dl2.vimm.net/?mediaId=5082&alt=2" },
    ]);
  });

  it("skips formats whose file has no size", () => {
    const html =
      dlForm("dl3.vimm.net") +
      formatSelect([".ciso", ".nkit.iso", ".rvz"]) +
      mediaScript([{ id: 7, title: "Game.iso", sizes: ["100 MB", "0 KB", "90 MB"] }]);

    const rows = parseVariations(html);
    expect(rows.map((r) => r.name)).toEqual(["Game.iso [.ciso]", "Game.iso [.rvz]"]);
    expect(rows.map((r) => r.downloadUrl)).toEqual([
      "https://dl3.vimm.net/?mediaId=7",
      "https://dl3.vimm.net/?mediaId=7&alt=2",
    ]);
  });

  it("returns nothing when there is no media array", () => {
    expect(parseVariations("<div>unavailable</div>")).toEqual([]);
  });
});
