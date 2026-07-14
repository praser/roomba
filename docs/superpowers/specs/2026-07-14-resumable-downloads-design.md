# Pause / resume downloads

**Date:** 2026-07-14
**Status:** Approved (design)

## Problem

`roomba download` streams to the destination in one shot. A large ROM
(hundreds of MB) that's interrupted must restart from zero.

## Approach (approved) — wget -c style, CLI-only

Ctrl-C pauses (partial kept); re-running the same command auto-resumes via an
HTTP `Range` request. Entirely in `apps/cli/src/download.ts` — no core or engine
changes. `downloadRequest` is already re-resolved every invocation, so a resume
gets a fresh signed URL/token (needed for Emuparadise) before continuing bytes.

## Partial file + naming

Stream to **`<dest>.part`**, rename to `<dest>` on completion. The `.part` path
is derived deterministically from the URL / `-o` (a **provisional** name) so a
re-run finds it. The **final** name is chosen at completion:
`Content-Disposition` → else the post-redirect `response.url` basename (decoded)
→ else the provisional. This also fixes Emuparadise files saving as `37713`
(no extension) — they now land as `… (USA) (v1.3).7z`.

Destination directory: `-o <file>` → that file (partial `<file>.part`);
`-o <dir>`/default → `~/Downloads` or the dir, partial `join(dir, provisional).part`.

## Resume via Range

If `<dest>.part` has size `N > 0`, GET with `Range: bytes=N-`:

| response | action |
|---|---|
| 206 Partial Content | append to `.part` from `N`; total from `Content-Range` |
| 200 OK (range ignored) | truncate `.part`, restart from 0 |
| 416 Range Not Satisfiable | `.part` already complete → rename → done |

Progress shows `(N + streamed) / total`; prints `Resuming from <N>…` when N > 0.

## Pause via SIGINT

An `AbortController` is wired to `SIGINT`. On Ctrl-C the fetch aborts, the
pipeline stops, the `.part` is kept, and the CLI prints
`Paused — re-run the same command to resume.` and exits 130.

## Pure, testable units

- `provisionalName(url)` — deterministic `.part` base name.
- `resumePlan(existingSize, status, {contentLength, contentRange})` →
  `{ action: "append" | "restart" | "complete", start, total }`.
- `parseContentDispositionFilename(header)` and
  `resolveFinalName(header, finalUrl, provisional)` — final-name resolution.

Plus a manual end-to-end: start an Emuparadise download, `SIGINT`, re-run,
confirm `Resuming from …` and completion.

## Rollout

One `apps/cli` change → a single `cli` release via the pipeline; `roomba update`.
