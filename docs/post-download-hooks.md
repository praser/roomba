# Post-download hooks

roomba is a plain downloader: it fetches a file and saves it. Anything that
should happen *after* a download — unpacking an archive, placing a ROM where an
emulator expects it, creating a launcher file, converting a format, refreshing a
game library, sending a notification — is left to **you**, through a
post-download hook.

A hook is just a shell script named `roomba.post-download.sh` that you drop into
the folder a download lands in. If it's there, roomba runs it after each
finished download. If it isn't, roomba does nothing extra. There is no
per-system logic baked into roomba — one hook mechanism serves every system,
emulator, and workflow.

---

## Table of contents

- [How it works](#how-it-works)
- [The contract](#the-contract)
  - [When the hook runs](#when-the-hook-runs)
  - [Where roomba looks for it](#where-roomba-looks-for-it)
  - [What roomba passes to it](#what-roomba-passes-to-it)
  - [How failures are handled](#how-failures-are-handled)
- [Writing your first hook](#writing-your-first-hook)
- [Important details and gotchas](#important-details-and-gotchas)
- [Examples](#examples)
  - [Extract an archive into its own folder](#extract-an-archive-into-its-own-folder)
  - [Only act on certain file types](#only-act-on-certain-file-types)
  - [Batocera: place a ROM and refresh EmulationStation](#batocera-place-a-rom-and-refresh-emulationstation)
  - [Create a launcher file for a data-only "game"](#create-a-launcher-file-for-a-data-only-game)
  - [Convert a disc image to CHD](#convert-a-disc-image-to-chd)
  - [Log every download](#log-every-download)
  - [Send a notification](#send-a-notification)
  - [Use bash instead of POSIX sh](#use-bash-instead-of-posix-sh)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Reference](#reference)

---

## How it works

When `roomba download <url>` finishes writing a file, roomba looks for a file
named exactly **`roomba.post-download.sh`** in the same folder the download was
saved to. If that file exists, roomba runs it with the system shell and hands it
the details of the download (which file, where, from what URL). Your script does
whatever you want with that information.

The hook is opt-in and local: it only runs if you created it, and it only
affects the folder you put it in. Downloads to a folder without a hook behave
exactly like a plain download.

---

## The contract

### When the hook runs

- **After a download completes successfully** and the final file has been moved
  into place (roomba prints `Saved to <path>` first, then runs the hook).
- It also runs when a **resumed** download completes, including the case where
  the file was already fully downloaded and roomba just finalizes it.
- It runs **once per completed download**.
- It does **not** run if the download fails, or if you cancel it with Ctrl-C
  (which pauses the download rather than finishing it).

### Where roomba looks for it

roomba looks for `roomba.post-download.sh` in the **destination folder** — the
directory the file was actually saved into:

| How you ran `download` | Destination folder | Hook location roomba checks |
|---|---|---|
| `roomba download <url>` (no `-o`) | your Downloads folder (`~/Downloads`) | `~/Downloads/roomba.post-download.sh` |
| `roomba download <url> -o ~/roms/` (a directory) | `~/roms/` | `~/roms/roomba.post-download.sh` |
| `roomba download <url> -o ~/roms/game.7z` (a file path) | `~/roms/` (the file's directory) | `~/roms/roomba.post-download.sh` |

The filename must match **exactly** — same case, no extra extension.

### What roomba passes to it

roomba invokes the hook as:

```sh
sh roomba.post-download.sh "<downloaded-file-basename>"
```

with the following context:

- **Working directory (`$PWD`)**: the destination folder. So a relative path
  like `./"$1"` refers to the downloaded file.
- **Positional argument `$1`**: the downloaded file's **base name** (no
  directory), e.g. `Some Game.7z`.
- **Environment variables**:

  | Variable | Value | Example |
  |---|---|---|
  | `ROOMBA_FILE` | Absolute path to the downloaded file | `/home/you/Downloads/Some Game.7z` |
  | `ROOMBA_FILENAME` | The file's base name (same as `$1`) | `Some Game.7z` |
  | `ROOMBA_URL` | The URL the file was downloaded from | `https://dl3.vimm.net/?mediaId=44190` |

  Your normal environment (`$PATH`, etc.) is passed through as well.

### How failures are handled

The hook is **best-effort** — it can never break a download you already have:

- If the hook exits **non-zero**, roomba prints
  `roomba: post-download hook exited <code>` to stderr but **still exits 0**.
  The downloaded file is left untouched.
- If the system has **no `sh`** available, roomba prints
  `roomba: could not run post-download hook (sh not found)` and continues.
- The hook's own stdout/stderr stream straight through to your terminal while it
  runs, so you see its output (and any progress) live.

---

## Writing your first hook

1. Decide which folder your downloads land in (Downloads by default, or whatever
   you pass to `-o`).
2. Create `roomba.post-download.sh` in that folder.
3. Make it do something with `$1` / `$ROOMBA_FILE`.

A minimal hook that just prints what happened:

```sh
# ~/Downloads/roomba.post-download.sh
echo "roomba downloaded '$1' from $ROOMBA_URL into $PWD"
```

Now download something into that folder:

```sh
roomba download "<url>"
```

You'll see roomba's `Saved to …` line followed by your hook's output.

> **No `chmod` needed.** roomba runs the hook with `sh roomba.post-download.sh`,
> so the file does **not** need an executable bit. (This also means the script's
> shebang line is ignored — see [gotchas](#important-details-and-gotchas).)

---

## Important details and gotchas

- **It runs under POSIX `sh`, not bash.** roomba always invokes
  `sh roomba.post-download.sh`, so a `#!/bin/bash` (or any) shebang is **ignored**
  and bash-only features (`[[ ]]`, arrays, `${var,,}`, etc.) may not work. Write
  portable POSIX shell, or [re-exec under bash](#use-bash-instead-of-posix-sh).
- **Quote your variables.** Filenames routinely contain spaces and parentheses
  (`Resident Evil 2 (Europe) (Disc 1).7z`). Always use `"$1"`, `"$ROOMBA_FILE"`,
  etc. Unquoted, they'll split into multiple arguments.
- **The hook fires for _every_ file that lands in the folder**, not just a
  specific game. If you download several different systems into one folder, the
  same hook runs for all of them — branch on `$1`'s extension or `$ROOMBA_URL`
  if you need per-type behavior (see
  [Only act on certain file types](#only-act-on-certain-file-types)).
- **The hook file is a normal file in the folder.** roomba never downloads over
  it unless a download happens to be named `roomba.post-download.sh`. It won't
  appear as a "game" in emulators, but be aware it sits alongside your ROMs.
- **A non-zero exit does not undo the download.** The file stays. Your hook is
  responsible for its own cleanup on partial failure.
- **Long-running hooks block roomba** until they finish (roomba waits for the
  script). If you need fire-and-forget, background the work yourself
  (`some-command & `) — but note roomba may exit before a backgrounded job
  completes.
- **`$ROOMBA_FILE` is absolute; `$1` is relative** to the destination folder
  (which is also the working directory). Use whichever is convenient.

---

## Examples

All examples are POSIX `sh`. Save them as `roomba.post-download.sh` in the
folder you download into.

### Extract an archive into its own folder

Unpack `.zip`/`.7z`/`.rar` into a subfolder named after the archive, then remove
the archive. Requires `7z` (p7zip) on `PATH`.

```sh
# roomba.post-download.sh
file="$1"

case "$file" in
  *.zip|*.7z|*.rar)
    dir="${file%.*}"              # "Some Game.7z" -> "Some Game"
    mkdir -p "$dir"
    if 7z x -o"$dir" -y "$file"; then
      rm -f "$file"              # only delete the archive if extraction succeeded
      echo "extracted into $dir/"
    else
      echo "extraction failed; keeping $file" >&2
      exit 1
    fi
    ;;
  *)
    echo "no post-processing for $file"
    ;;
esac
```

### Only act on certain file types

Branch on the extension (or the source URL) so a shared folder does the right
thing per file:

```sh
# roomba.post-download.sh
case "$ROOMBA_FILENAME" in
  *.chd|*.iso|*.cue) echo "disc image, leaving as-is" ;;
  *.zip|*.7z)        echo "archive — would extract here" ;;
  *)                 echo "unhandled type: $ROOMBA_FILENAME" ;;
esac
```

### Batocera: place a ROM and refresh EmulationStation

On Batocera, move the file into the right system folder and rescan so it appears
without a reboot. (This replaces roomba's old built-in Batocera placement.)

```sh
# roomba.post-download.sh   (e.g. in ~/Downloads on Batocera)
system="psx"                                   # target ROM folder
dest="/userdata/roms/$system"

mkdir -p "$dest"
mv -f "$ROOMBA_FILE" "$dest/$ROOMBA_FILENAME"
echo "placed $ROOMBA_FILENAME in $dest"

# Ask EmulationStation to rescan (ignore failure if the tool isn't present).
batocera-es-swissknife --restart 2>/dev/null || true
```

> Tip: download straight into the system folder instead of moving —
> `roomba download <url> -o /userdata/roms/psx/` — and put the hook there to do
> only the refresh.

### Create a launcher file for a data-only "game"

Some Batocera systems (ports, engines) need an empty launcher file with a
specific extension next to the downloaded data. Example for a `.game` system:

```sh
# roomba.post-download.sh
# After downloading the game data archive, unpack it and create the launcher.
name="${ROOMBA_FILENAME%.*}"       # drop extension for the launcher name
7z x -y "$ROOMBA_FILE" >/dev/null
touch "$name.game"                 # EmulationStation sees this and launches it
echo "created launcher $name.game"
```

### Convert a disc image to CHD

Turn a freshly downloaded `.cue`/`.iso` into a compressed `.chd` (needs
`chdman`):

```sh
# roomba.post-download.sh
case "$ROOMBA_FILENAME" in
  *.cue|*.iso)
    out="${ROOMBA_FILENAME%.*}.chd"
    if chdman createcd -i "$ROOMBA_FILE" -o "$out"; then
      rm -f "$ROOMBA_FILE"
      echo "converted to $out"
    fi
    ;;
esac
```

### Log every download

Append a line to a log file for a record of what you've fetched:

```sh
# roomba.post-download.sh
printf '%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$ROOMBA_FILENAME" "$ROOMBA_URL" \
  >> "$HOME/roomba-downloads.log"
```

### Send a notification

Ping yourself when a (possibly large) download finishes. Desktop example
(`notify-send`) and a webhook example:

```sh
# roomba.post-download.sh
notify-send "roomba" "Downloaded $ROOMBA_FILENAME" 2>/dev/null || true

# or a webhook (needs curl):
curl -fsS -X POST "$MY_WEBHOOK_URL" \
  -d "text=roomba downloaded $ROOMBA_FILENAME" >/dev/null 2>&1 || true
```

### Use bash instead of POSIX sh

Because roomba invokes the hook via `sh`, the shebang is ignored. If you want
bash features, re-exec the script under bash from its first lines:

```sh
# roomba.post-download.sh
if [ -z "$BASH_VERSION" ]; then exec bash "$0" "$@"; fi

# --- everything below runs under bash ---
shopt -s nullglob
lower="${ROOMBA_FILENAME,,}"       # bash-only lowercase
echo "processing $lower"
```

---

## Security

roomba runs whatever `roomba.post-download.sh` contains, with your user's
permissions, every time a download finishes in that folder. That's the point —
but it means:

- **Only put scripts you wrote or trust** into your download folders. Don't drop
  a `roomba.post-download.sh` you copied from an untrusted source without reading
  it.
- Be careful with shared/synced folders (network shares, cloud-synced
  directories): anyone who can write `roomba.post-download.sh` there can run code
  as you on your next download.
- The hook receives `ROOMBA_URL` verbatim; if you interpolate it into further
  commands, quote it and treat it as untrusted input.

---

## Troubleshooting

**The hook didn't run.**
- Is it named exactly `roomba.post-download.sh` (no `.txt`, correct case)?
- Is it in the folder the file actually landed in? Check roomba's `Saved to …`
  line — the hook must be in that file's directory.
- Are you on roomba 3.0 or newer? (Earlier versions had different behavior.)
- Did the download actually complete? A cancelled (Ctrl-C) download is paused,
  not finished, and won't fire the hook.

**The hook ran but "failed".**
- roomba prints `roomba: post-download hook exited <code>`. Run your script
  by hand to debug: `cd <folder> && ROOMBA_FILE=... ROOMBA_FILENAME=... ROOMBA_URL=... sh roomba.post-download.sh "<name>"`.
- Remember it runs under `sh`, not bash — a bash-ism is a common cause.

**`roomba: could not run post-download hook (sh not found)`.**
- The system has no `sh` on `PATH`. Install a POSIX shell, or run roomba in an
  environment that has one.

**A variable expands to nothing / splits weirdly.**
- Quote it: `"$1"`, `"$ROOMBA_FILE"`. Filenames with spaces are the usual
  culprit.

---

## Reference

| Item | Value |
|---|---|
| Hook filename | `roomba.post-download.sh` (exact) |
| Location searched | the download's destination folder |
| Invocation | `sh roomba.post-download.sh "<basename>"` |
| Working directory | the destination folder |
| `$1` | downloaded file's base name |
| `$ROOMBA_FILE` | absolute path to the downloaded file |
| `$ROOMBA_FILENAME` | downloaded file's base name |
| `$ROOMBA_URL` | source URL of the download |
| Runs on | successful (including resumed/completed) downloads, once each |
| Does not run on | failed or paused (Ctrl-C) downloads, or when the hook file is absent |
| On non-zero exit | warning to stderr; roomba still exits 0; file kept |
| Executable bit | not required (invoked via `sh`; shebang ignored) |
