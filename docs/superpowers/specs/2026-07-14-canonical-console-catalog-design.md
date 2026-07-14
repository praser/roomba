# Canonical console catalog + per-engine mapping

**Date:** 2026-07-14
**Status:** Approved (design)

## Problem

With two engines installed, `roomba consoles` lists the same physical console
twice under different, engine-defined aliases (vimm `GBA` / Emuparadise `31` for
Game Boy Advance), and `roomba search <alias>` is inconsistent across engines.
We want one canonical alias per console so identical consoles merge and search
is uniform.

## Decisions

- **Canonical aliases are short lowercase slugs** (`gba`, `snes`, `ps2`, `n64`).
- **`@praser/roomba-core` owns a catalog** of canonical consoles (`{ name, alias }`).
  It is wide/exhaustive: the [consoledatabase.com](https://www.consoledatabase.com/consoleinfo/)
  list **union** every system our engines serve. Core knows more consoles than
  any engine.
- **Each engine maps its own internal ids → canonical slugs.** `loadConsoles`
  emits core's `{name, alias}` for the systems it maps and **drops** anything it
  doesn't map. `search(alias)` reverse-maps the canonical slug to the engine's
  internal id.
- **`roomba consoles` shows only consoles mapped by ≥1 installed engine** — a
  catalog entry no engine maps (e.g. "Hasbro Pox") never appears.
- **`ENGINE_API_VERSION` stays 1** (additive change). `RoomSource`/`RoomEngine`
  signatures are unchanged. `@praser/roomba-core` bumps `1.1.0 → 1.2.0`.

## Core (`@praser/roomba-core` 1.2.0)

Additive exports alongside the existing `Console` type:

```ts
export const CONSOLES: readonly Console[];              // canonical catalog
export const CONSOLE_BY_ALIAS: ReadonlyMap<string, Console>;
```

`alias` is the canonical slug; `name` is the canonical display name (the single
source of truth for both, so all engines render identically).

## Engine pattern (vimm, emuparadise)

Each engine adds a static map from **its internal id → canonical slug**, with at
most one internal id per slug (pick a primary if the site has duplicates, e.g.
Emuparadise's two ZX Spectrum sections).

- `loadConsoles()`: scrape as before; for each system, if its internal id is in
  the map, emit `CONSOLE_BY_ALIAS.get(slug)`; otherwise drop it. Result: both
  engines return `{name:"Game Boy Advance", alias:"gba"}` and
  `collectConsoles` merges them (`sources: vimm, emuparadise`).
- `search(alias, query)`: `alias` is the canonical slug; reverse-map to the
  internal id and search as before.

Engines bump their `@praser/roomba-core` dependency to `^1.2.0`.

## No CLI changes

`collectConsoles` already merges consoles by alias, and `searchGames` calls
`source.search(match.alias, …)` per source — both work unchanged once aliases
are canonical.

## Rollout

1. Publish `@praser/roomba-core@1.2.0` to npm.
2. Rebuild + release `roomba-vimm` and `roomba-emuparadise` (new S3 versions).
3. Reinstall; verify `roomba consoles` merges shared consoles under one slug.

## Curation

The catalog includes every engine system plus the real, distinct consoles from
the consoledatabase list. Obvious homebrew/clone/prototype/accessory entries
that would collide or never map (e.g. Bankzilla, NPES, Portendo, "PSp",
"SNESp", Puma 2600, Video Driver, console variants/VMUs) are omitted; they can
be added later without breaking anything.
