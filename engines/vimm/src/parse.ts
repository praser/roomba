import { parse } from "node-html-parser";

/** A search-results row — release-level metadata shared by all its files. */
export interface SearchListing {
  /** Vault id of the release detail page. */
  id: string;
  title: string;
  region: string;
  languages: string;
  rating: string;
}

/** A single downloadable variation parsed from a release detail page. */
export interface Variation {
  name: string;
  version: string;
  size: string;
  downloadUrl: string;
}

/** Shape of the entries in the `let media=[...]` array embedded in a detail page. */
interface RawMedia {
  ID: number;
  GoodTitle: string; // base64-encoded
  Version: string;
  SortOrder: number;
  ZippedText: string;
  AltZippedText: string;
  AltZipped2Text: string;
}

/** Parse the `?p=list` search results page into release listings. */
export function parseSearchListings(html: string): SearchListing[] {
  const root = parse(html);
  const listings: SearchListing[] = [];

  for (const row of root.querySelectorAll("tr")) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 5) continue;

    // The game link is the first /vault/<numeric-id> anchor with visible text
    // (each row also has an empty /vault/999999 placeholder anchor).
    const link = cells[0]!
      .querySelectorAll("a")
      .find((anchor) => {
        const href = anchor.getAttribute("href") ?? "";
        return /^\/vault\/\d+$/.test(href) && href !== "/vault/999999" && anchor.text.trim() !== "";
      });
    if (!link) continue;

    const id = link.getAttribute("href")!.split("/").pop()!;
    const region = cells[1]!
      .querySelectorAll("img")
      .map((img) => img.getAttribute("title")?.trim())
      .filter((title): title is string => Boolean(title))
      .join(", ");

    listings.push({
      id,
      title: link.text.trim(),
      region: region || "-",
      languages: cells[3]!.text.trim() || "-",
      rating: cells[4]!.text.trim() || "-",
    });
  }

  return listings;
}

/** Read the download host (e.g. "dl3.vimm.net") from a detail page's form. */
function parseDownloadHost(html: string): string {
  const match = html.match(/action="\/\/([^/"]+)\/"[^>]*id="dl_form"/);
  return match?.[1] ?? "dl3.vimm.net";
}

/**
 * Parse every downloadable variation from a release detail page: the embedded
 * `media` array (discs/revisions) crossed with the `dl_format` options
 * (formats), skipping combinations with no file.
 */
export function parseVariations(html: string): Variation[] {
  const mediaMatch = html.match(/let media=(\[.*?\]);/s);
  if (!mediaMatch) return [];

  let media: RawMedia[];
  try {
    media = JSON.parse(mediaMatch[1]!);
  } catch {
    return [];
  }

  const selectMatch = html.match(/<select id="dl_format"[^>]*>(.*?)<\/select>/s);
  const formats = selectMatch
    ? [...selectMatch[1]!.matchAll(/<option value="(\d)"[^>]*>([^<]+)<\/option>/g)].map(
        (option) => ({ alt: Number(option[1]), label: option[2]!.trim() }),
      )
    : [{ alt: 0, label: "" }];

  const host = parseDownloadHost(html);
  const variations: Variation[] = [];

  for (const entry of media) {
    const title = Buffer.from(entry.GoodTitle, "base64").toString("utf8");
    const sizes = [entry.ZippedText, entry.AltZippedText, entry.AltZipped2Text];

    // Formats this entry actually ships (non-zero size). Each is a distinct
    // downloadable file, addressed by Vimm's download endpoint via mediaId+alt.
    const available = formats.filter((format) => {
      const size = sizes[format.alt];
      return size && size !== "0" && size !== "0 KB";
    });
    const multipleFormats = available.length > 1;

    for (const format of available) {
      const url = new URL(`https://${host}/`);
      url.searchParams.set("mediaId", String(entry.ID));
      if (format.alt !== 0) url.searchParams.set("alt", String(format.alt));

      const name =
        multipleFormats && format.label ? `${title} [${format.label}]` : title;
      variations.push({
        name,
        version: entry.Version,
        size: sizes[format.alt] ?? "-",
        downloadUrl: url.href,
      });
    }
  }

  return variations;
}
