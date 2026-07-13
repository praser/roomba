# roomba-engine-vimm

A [roomba](https://github.com/) engine for [Vimm's Lair](https://vimm.net).

## Build

```bash
pnpm install
pnpm build   # -> dist/vimm.mjs
```

## Install into roomba

```bash
roomba engine install <url-to-dist/vimm.mjs>
```

The bundle default-exports a `RoomEngine` (see `@roomba/core`) with `id: "vimm"`,
built against `ENGINE_API_VERSION` 1.
