import type { Fetcher, HttpResponse } from "@roomba/core";
import { describe, expect, it } from "vitest";
import { VimmRoomSource } from "../src/source.js";

const b64 = (title: string): string => Buffer.from(title, "utf8").toString("base64");
const ok = (body: string): HttpResponse => ({ status: 200, ok: true, body });
const notFound = (): HttpResponse => ({ status: 404, ok: false, body: "" });

const VAULT_HTML = `<div id="subMenu"><a href="/vault/NES">Nintendo</a><a href="/vault/PS1">PlayStation</a></div>`;

const LIST_HTML = `
  <table class="hovertable">
    <tr><th>Title</th><th>Region</th><th>Version</th><th>Languages</th><th>Rating</th></tr>
    <tr>
      <td><a href="/vault/999999"></a><a href="/vault/50813">Resident Evil 2</a></td>
      <td><img src="/f/eu.png" title="Europe"></td>
      <td>1.0</td><td>-</td><td><a href="#">9.6</a></td>
    </tr>
  </table>`;

const DETAIL_HTML =
  `<form action="//dl3.vimm.net/" method="POST" id="dl_form"></form>` +
  `<script>let media=[` +
  JSON.stringify({
    ID: 44190,
    GoodTitle: b64("Resident Evil 2 (Europe) (Disc 1)"),
    Version: "1.0",
    SortOrder: 1,
    ZippedText: "330 MB",
    AltZippedText: "0 KB",
    AltZipped2Text: "0 KB",
  }) +
  `,` +
  JSON.stringify({
    ID: 44545,
    GoodTitle: b64("Resident Evil 2 (Europe) (Disc 2)"),
    Version: "1.0",
    SortOrder: 2,
    ZippedText: "332 MB",
    AltZippedText: "0 KB",
    AltZipped2Text: "0 KB",
  }) +
  `];</script>`;

const fetcher: Fetcher = async (url) => {
  if (url.pathname === "/vault") return ok(VAULT_HTML);
  if (url.pathname === "/vault/" && url.searchParams.get("p") === "list") {
    return url.searchParams.get("q") === "missing" ? notFound() : ok(LIST_HTML);
  }
  if (/^\/vault\/\d+$/.test(url.pathname)) return ok(DETAIL_HTML);
  throw new Error(`unexpected request: ${url.href}`);
};

function source(): VimmRoomSource {
  return new VimmRoomSource({ fetcher });
}

describe("VimmRoomSource", () => {
  it("resolves an alias to its vault URL", () => {
    expect(source().resolve("PS2").href).toBe("https://vimm.net/vault/PS2");
  });

  it("loads consoles from the vault sub-menu", async () => {
    expect(await source().loadConsoles()).toEqual([
      { name: "Nintendo", alias: "NES" },
      { name: "PlayStation", alias: "PS1" },
    ]);
  });

  it("searches, joining release metadata with each file", async () => {
    const games = await source().search("PS1", "resident");
    expect(games).toEqual([
      { name: "Resident Evil 2 (Europe) (Disc 1)", region: "Europe", version: "1.0", languages: "-", rating: "9.6", size: "330 MB", downloadUrl: "https://dl3.vimm.net/?mediaId=44190" },
      { name: "Resident Evil 2 (Europe) (Disc 2)", region: "Europe", version: "1.0", languages: "-", rating: "9.6", size: "332 MB", downloadUrl: "https://dl3.vimm.net/?mediaId=44545" },
    ]);
  });

  it("returns no games when the search 404s", async () => {
    expect(await source().search("PS1", "missing")).toEqual([]);
  });

  describe("downloadRequest", () => {
    it("supplies a browser UA and Referer for vimm hosts", () => {
      const request = source().downloadRequest(new URL("https://dl3.vimm.net/?mediaId=1"));
      expect(request?.headers.referer).toBe("https://vimm.net/");
      expect(request?.headers["user-agent"]).toMatch(/Mozilla/);
    });

    it("ignores non-vimm URLs", () => {
      expect(source().downloadRequest(new URL("https://example.com/x.7z"))).toBeNull();
    });
  });
});
