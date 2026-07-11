import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DownloadRequest } from "@roomba/core";
import { SOURCES } from "./sources.js";

/** Download a file from a source's URL, saving it locally. */
export async function downloadFile(rawUrl: string, output?: string): Promise<void> {
  const url = new URL(rawUrl);

  const request = pickDownloadRequest(url);
  if (!request) {
    throw new Error(`No source knows how to download ${url.href}`);
  }

  const response = await fetch(request.url, { headers: request.headers });
  if (!response.ok || !response.body) {
    throw new Error(
      `Download failed: ${response.status} ${response.statusText} for ${url.href}`,
    );
  }

  const filename = filenameFromResponse(response, url);
  const destination = await resolveDestination(output, filename);

  const total = Number(response.headers.get("content-length")) || 0;
  await pipeline(
    Readable.fromWeb(response.body),
    progressReporter(total),
    createWriteStream(destination),
  );
  process.stderr.write("\n");
  console.log(`Saved to ${destination}`);
}

function pickDownloadRequest(url: URL): DownloadRequest | null {
  for (const source of SOURCES) {
    const request = source.downloadRequest(url);
    if (request) return request;
  }
  return null;
}

/** Resolve where to write: explicit file, directory + server name, or Downloads. */
async function resolveDestination(
  output: string | undefined,
  filename: string,
): Promise<string> {
  if (!output) {
    const downloads = join(homedir(), "Downloads");
    await mkdir(downloads, { recursive: true });
    return join(downloads, filename);
  }

  const treatAsDir =
    output.endsWith("/") || output.endsWith(sep) || (await isDirectory(output));
  if (treatAsDir) {
    await mkdir(output, { recursive: true });
    return join(output, filename);
  }

  await mkdir(dirname(output), { recursive: true });
  return output;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Derive the filename from Content-Disposition, falling back to the URL. */
function filenameFromResponse(response: Response, url: URL): string {
  const header = response.headers.get("content-disposition");
  if (header) {
    const encoded = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
    if (encoded?.[1]) {
      return basename(decodeURIComponent(stripQuotes(encoded[1].trim())));
    }
    const quoted = header.match(/filename="([^"]+)"/i) ?? header.match(/filename=([^;]+)/i);
    if (quoted?.[1]) return basename(quoted[1].trim());
  }

  const mediaId = url.searchParams.get("mediaId");
  return mediaId ? `${mediaId}.7z` : basename(url.pathname) || "download";
}

function stripQuotes(value: string): string {
  return value.replace(/^"|"$/g, "");
}

/** A pass-through stream that prints download progress to stderr. */
function progressReporter(total: number): Transform {
  let downloaded = 0;
  let lastPrint = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloaded += chunk.length;
      const now = Date.now();
      if (now - lastPrint > 200 || (total && downloaded >= total)) {
        lastPrint = now;
        const status = total
          ? `${formatBytes(downloaded)} / ${formatBytes(total)} (${((downloaded / total) * 100).toFixed(1)}%)`
          : formatBytes(downloaded);
        process.stderr.write(`\rDownloading… ${status}`);
      }
      callback(null, chunk);
    },
  });
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
