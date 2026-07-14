import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DownloadRequest, RoomSource } from "@praser/roomba-core";

/**
 * Download a file, resuming a prior partial (`<dest>.part`) via an HTTP Range
 * request when one exists. Ctrl-C pauses (the partial is kept); re-running the
 * same command resumes. On completion the partial is renamed to its final name.
 */
export async function downloadFile(
  sources: RoomSource[],
  rawUrl: string,
  output?: string,
): Promise<void> {
  const url = new URL(rawUrl);

  const request = await pickDownloadRequest(sources, url);
  if (!request) {
    throw new Error(`No source knows how to download ${url.href}`);
  }

  // The .part path is derived from the URL/-o (not the response), so it's stable
  // across runs and a re-run finds it to resume.
  const { dir, fixedFile } = await targetDir(output);
  const provisional = provisionalName(url);
  const partialPath = fixedFile ? `${fixedFile}.part` : join(dir, `${provisional}.part`);
  const existing = await fileSize(partialPath);

  const headers = { ...request.headers };
  if (existing > 0) headers.Range = `bytes=${existing}-`;

  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  process.once("SIGINT", onSigint);

  try {
    const response = await fetch(request.url, { headers, signal: controller.signal });

    const plan = resumePlan(existing, response.status, {
      contentLength: Number(response.headers.get("content-length")) || 0,
      contentRange: response.headers.get("content-range"),
    });

    const finalDest = fixedFile
      ? fixedFile
      : join(
          dir,
          resolveFinalName(
            response.headers.get("content-disposition"),
            new URL(response.url),
            provisional,
          ),
        );

    // The partial already holds every byte — just finalize it.
    if (plan.action === "complete") {
      await rename(partialPath, finalDest);
      console.log(`Saved to ${finalDest}`);
      return;
    }

    if (!response.ok || !response.body) {
      throw new Error(
        `Download failed: ${response.status} ${response.statusText} for ${url.href}`,
      );
    }

    if (plan.action === "append") {
      process.stderr.write(`Resuming from ${formatBytes(plan.start)}…\n`);
    }

    await pipeline(
      Readable.fromWeb(response.body),
      progressReporter(plan.total, plan.start),
      createWriteStream(partialPath, { flags: plan.action === "append" ? "a" : "w" }),
    );

    await rename(partialPath, finalDest);
    process.stderr.write("\n");
    console.log(`Saved to ${finalDest}`);
  } catch (error) {
    if (controller.signal.aborted) {
      process.stderr.write("\n");
      console.log("Paused — re-run the same command to resume.");
      process.exitCode = 130;
      return;
    }
    throw error;
  } finally {
    process.off("SIGINT", onSigint);
  }
}

async function pickDownloadRequest(
  sources: RoomSource[],
  url: URL,
): Promise<DownloadRequest | null> {
  for (const source of sources) {
    // Awaited: an engine may navigate intermediate pages to resolve the link.
    // Non-matching engines reject cheaply (host check) before any network.
    const request = await source.downloadRequest(url);
    if (request) return request;
  }
  return null;
}

/** What to do given the existing partial size and the server's response. */
export interface ResumePlan {
  action: "append" | "restart" | "complete";
  /** Bytes already on disk that the progress bar should start from. */
  start: number;
  /** Full expected size of the file, when known (0 if the server didn't say). */
  total: number;
}

/** Decide how to proceed from the partial size and the response status. */
export function resumePlan(
  existing: number,
  status: number,
  headers: { contentLength: number; contentRange: string | null },
): ResumePlan {
  if (existing > 0 && status === 206) {
    const total = contentRangeTotal(headers.contentRange) || existing + headers.contentLength;
    return { action: "append", start: existing, total };
  }
  if (existing > 0 && status === 416) {
    return { action: "complete", start: existing, total: existing };
  }
  // Fresh download, or the server ignored our Range and sent the whole file.
  return { action: "restart", start: 0, total: headers.contentLength };
}

/** Parse the total size from a "bytes 100-439/440" Content-Range header. */
function contentRangeTotal(header: string | null): number {
  const match = header ? /\/(\d+)\s*$/.exec(header) : null;
  return match ? Number(match[1]) : 0;
}

/** Stable, response-independent name used for the `.part` file. */
export function provisionalName(url: URL): string {
  const mediaId = url.searchParams.get("mediaId");
  if (mediaId) return `${mediaId}.7z`;
  return basename(url.pathname) || "download";
}

/**
 * The name to save the finished file as: the Content-Disposition filename, else
 * the (decoded) basename of the final (post-redirect) URL if it has an
 * extension, else the provisional name.
 */
export function resolveFinalName(
  contentDisposition: string | null,
  finalUrl: URL,
  provisional: string,
): string {
  const fromHeader = parseContentDispositionFilename(contentDisposition);
  if (fromHeader) return fromHeader;

  const fromUrl = decodeURIComponent(basename(finalUrl.pathname));
  if (fromUrl && fromUrl.includes(".")) return fromUrl;

  return provisional;
}

/** Extract a filename from a Content-Disposition header, or null if absent. */
export function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const encoded = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (encoded?.[1]) return basename(decodeURIComponent(stripQuotes(encoded[1].trim())));
  const quoted = header.match(/filename="([^"]+)"/i) ?? header.match(/filename=([^;]+)/i);
  if (quoted?.[1]) return basename(quoted[1].trim());
  return null;
}

function stripQuotes(value: string): string {
  return value.replace(/^"|"$/g, "");
}

/** Resolve the target directory (and a fixed file path if -o names a file). */
async function targetDir(
  output: string | undefined,
): Promise<{ dir: string; fixedFile?: string }> {
  if (!output) {
    const dir = join(homedir(), "Downloads");
    await mkdir(dir, { recursive: true });
    return { dir };
  }

  const asDir = output.endsWith("/") || output.endsWith(sep) || (await isDirectory(output));
  if (asDir) {
    await mkdir(output, { recursive: true });
    return { dir: output };
  }

  await mkdir(dirname(output), { recursive: true });
  return { dir: dirname(output), fixedFile: output };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

/** A pass-through stream that prints download progress to stderr. */
function progressReporter(total: number, start = 0): Transform {
  let downloaded = start;
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

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
