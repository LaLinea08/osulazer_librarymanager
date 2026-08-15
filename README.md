# osu!lazer Library Manager

[![CI](https://github.com/LaLinea08/osulazer_librarymanager/actions/workflows/ci.yml/badge.svg)](https://github.com/LaLinea08/osulazer_librarymanager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A fast, safety-first Windows desktop browser and guarded whole-set maintenance
tool for large osu!lazer beatmap libraries. Scanning turns a verified read-only
snapshot into a local SQLite index. An explicitly confirmed maintenance flow can
then queue complete beatmap sets for osu!lazer's own reference-aware cleanup.

> [!IMPORTANT]
> Whole-set deletion is an **unsupported external integration**, not an official
> osu! API. It is limited to verified Realm schema 51 libraries, requires osu!
> to be closed, refuses protected sets, and creates a verified recovery package
> before changing only `BeatmapSet.DeletePending` in one transaction. The
> default-on played-set guard also skips a complete set when any of its
> difficulties has recorded play evidence. The manager never directly deletes
> or moves osu!'s content-addressed blobs.

## What works today

- Automatic discovery of the default `%APPDATA%\osu` data root and custom
  `storage.ini` locations, with manual folder selection as a fallback.
- A dashboard for set and difficulty counts, logical library size, game modes,
  ranked status, star ranges, BPM ranges, and recorded play timestamps.
- A virtualized, sortable difficulty table designed to stay responsive with
  large libraries.
- Text search, structured quick-search tokens, built-in views, and a nested
  `AND` / `OR` / `NOT` filter builder.
- App-owned saved filters, explicit selection counts, select-all-filtered, and
  clipboard copying of selected beatmap metadata.
- A details panel for metadata, online IDs, dates, local score rows, difficulty
  values, media flags, logical set size, and the encoded beatmap hash.
- Storage and cleanup views for large sets, video-containing sets, old or
  missing play timestamps, and low persisted star ratings.
- Guarded deletion previews that expand any selected difficulty to its complete
  beatmap set, skip sets with recorded play evidence by default, and block
  protected or already-pending sets.
- Verified recovery packages containing a full Realm copy, every blob referenced
  by the selected sets, a manifest, and a re-importable `.olz` for each set.
- A local operation history for scans, queued deletions, recovery, and failures.
- Browsing of the last successful index while osu! is open. Fresh scans remain
  blocked until the game is closed, as do deletion and automatic recovery.

Built-in library views include recently added, recently played, no recorded
play timestamp, ranked, loved, graveyard, and each of osu!'s four game modes.

## Compatibility and safety

The current adapter accepts **Realm schema 51 only**. A Realm schema is an
internal storage format, not an osu! release number. Earlier, later, or
shape-incompatible databases are rejected until their layouts have been
reviewed and tested.

### Read-only indexing boundary

A fresh scan follows this boundary:

```text
osu! data root
  client.realm --filesystem copy--> disposable app-owned snapshot
                                           |
                                           | Realm read-only, upgrades disabled
                                           v
                                     detached records
  files/<hash path> ---------------------- stat sizes only
                                           |
                                           v
                               app-owned SQLite index --> desktop UI
```

The application:

- checks that osu! is closed before and after copying the database;
- verifies the source file did not change during the copy;
- opens only the disposable copy with Realm's read-only mode and format upgrades
  disabled;
- validates both the schema number and required object/property shapes;
- closes Realm before inspecting referenced blob sizes;
- replaces its SQLite index only after a complete extraction succeeds; and
- preserves the previous index after cancellation, incompatibility, or scan
  failure.

### Guarded whole-set deletion boundary

The separate maintenance path is deliberately narrow:

```text
fresh verified index + selected difficulties
                  |
                  v
       expand to complete beatmap sets
                  |
                  v
default-on whole-set recorded-play protection
                  |
                  v
schema/root/osu!/fingerprint/Protected checks
                  |
                  v
app-owned recovery package
  full client.realm copy
  + every selected-set blob
  + verified per-set .olz archives
  + manifest
                  |
                  v
re-check live graph and source fingerprint
                  |
                  v
one Realm transaction: DeletePending = true
                  |
                  v
osu! startup performs its own reference-aware cleanup
```

The manager never removes blobs from `files/`. Before osu! starts, a queued
operation can be undone by clearing the same flags in one guarded transaction.
After osu! has finalized cleanup, the retained `.olz` archives can be imported
back into osu! manually.

For the complete model map, discovery rules, field semantics, capability matrix,
and upstream source references, read
[Library integration and safety](docs/LIBRARY_INTEGRATION.md).

## Download and run

Published builds currently target **Windows x64**.

1. Open the [latest GitHub Release](https://github.com/LaLinea08/osulazer_librarymanager/releases/latest).
2. Download either the portable `.exe` or the `.zip`. Extract the ZIP before
   running the application.
3. Optionally compare the download with the release's `SHA256SUMS.txt`:

   ```powershell
   Get-FileHash .\osu-lazer-library-manager-*-windows-x64-portable.exe -Algorithm SHA256
   ```

4. Close osu!lazer, then start the manager.

There is no installer in the current release pipeline. Builds are not
code-signed, so Windows may show a Microsoft Defender SmartScreen prompt.

Development builds from the `main` branch are available from the
[CI workflow](https://github.com/LaLinea08/osulazer_librarymanager/actions/workflows/ci.yml)
for 14 days. Tagged releases are the recommended downloads.

## First scan

1. Exit osu!lazer completely.
2. Let the application detect the library, or select the data root manually.
   The selected folder must contain both `client.realm` and `files/`.
3. Start the read-only scan. Large libraries can take time because the manager
   also checks referenced resource sizes.
4. Browse the resulting local index. Later launches can reuse it without
   rescanning.

If osu! starts during a scan, the database changes while it is copied, or the
schema is unsupported, the scan stops and the last successful index remains
available.

## Deleting beatmap sets safely

1. Exit osu!lazer completely and run a fresh scan.
2. Select one or more difficulties. The preview expands the selection to every
   complete set containing those difficulties; individual-difficulty deletion
   is intentionally unavailable.
3. Leave **Protect played sets** enabled (the default) to skip a complete set
   whenever any difficulty in it has recorded play evidence, even when that
   played difficulty is hidden or does not match the current filter. Evidence
   means a `LastPlayed` timestamp, one or more local `Score` rows, or a positive
   play count if a compatible adapter can provide one. Review the preview's
   skipped and eligible set counts.
4. Review the exact eligible set count and logical size. The manager rechecks
   the data root, schema 51, source fingerprint, process state, selected-set
   graph, whole-set play evidence, `Protected`, and `DeletePending` state.
5. Type the displayed `DELETE 1 SET` or `DELETE N SETS` phrase exactly. Before
   any write, the manager copies and verifies the full `client.realm`, every
   unique blob referenced by the selected sets, a manifest, and one importable
   `.olz` archive per set.
6. The manager sets only `DeletePending = true` for those sets in one Realm
   transaction. Start osu! to let its normal startup cleanup finalize deletion,
   or use Recovery to undo the queued flags **before opening osu!**.

Recovery packages are app-owned and retained after queuing. If osu! has already
removed the pending records, automatic undo is no longer possible; import the
verified `.olz` files instead.

## Searching

Plain words search artist, title, difficulty, mapper, source, and tags. Tokens
can be combined with plain text:

```text
mode:mania stars:4..6 bpm:>180
mapper:"Camellia" status:ranked
size:>100mb video:true
lastplayed:>1y background:yes
```

Useful aliases include `artist`, `title`, `diff`, `mapper`, `mode`, `status`,
`bpm`, `length`, `stars`, `ar`, `od`, `cs`, `hp`, `source`, `tags`, `id`,
`setid`, `added`, `lastplayed`, `scores`, `size`, `video`, and `background`.
Numeric tokens accept comparisons (`>`, `>=`, `<`, `<=`) and ranges such as
`4..6`. Storage values accept `kb`, `mb`, or `gb`; relative dates accept `d`,
`w`, `m`, or `y`.

For more complex queries, the filter builder supports nested groups up to three
levels deep and exposes field-appropriate comparison, range, empty-value, and
relative-date operators.

## Current limitations

- osu! exposes no supported external local-library maintenance API. Whole-set
  deletion therefore follows a reviewed internal schema-51 lifecycle and may
  stop working after an osu! update. Unknown schemas and shapes fail closed.
- Only complete sets can be queued. Individual-difficulty deletion, hiding,
  renaming, moving, collection membership editing, general-purpose export,
  duplicate removal, and Realm repair remain unavailable.
- Recovery `.olz` files are generated only as part of a verified deletion
  package; they are not a general library-export feature.
- Storage totals are **logical set sizes**, deduplicated only within each set.
  Blobs may be shared by other sets, scores, replays, or skins, so these totals
  are not estimates or promises of disk space reclaimed by deletion.
- The manager does not delete source blobs. osu! decides which unreferenced
  blobs can be removed during its own startup cleanup.
- `LastPlayed` is a recorded timestamp, not a full play history. Local score
  count measures stored score rows; osu!lazer does not persist a count of every
  play attempt in the indexed model. The played-set guard therefore means “no
  locally recorded play evidence,” not proof that the set has never been
  played. It deliberately treats either a timestamp or a score row as enough to
  protect the complete set.
- Star ratings are persisted base values and can be unavailable or differ after
  ruleset conversion and mods.
- Hidden difficulties and sets already marked pending deletion are excluded from
  the browser index. Hidden difficulties are still included when the deletion
  manager decides whether a complete set has recorded play evidence.
- Only verified schema 51 libraries can be freshly scanned. Cached data remains
  usable when a later schema is encountered.

## Development

Prerequisites:

- Windows
- Git
- Node.js `24.19.0` and npm

Install dependencies and start Electron with live reload:

```powershell
git clone https://github.com/LaLinea08/osulazer_librarymanager.git
cd osulazer_librarymanager
npm ci
npm run dev
```

Available checks and builds:

```powershell
npm run format:check  # verify Prettier formatting
npm run lint          # ESLint with zero warnings allowed
npm test              # Vitest test suite
npm run typecheck     # main/preload and renderer TypeScript checks
npm run build         # type-check and build all Electron processes
npm run package       # unpacked application directory
npm run dist:win      # Windows x64 portable EXE and ZIP in dist/
```

`npm run dev` and `npm run build` generate an app-owned build identity containing
the package version and Git commit. CI stamps main-branch artifacts as
`<base>-dev.<run>+<sha>`; tagged releases use the tag's stable version.

## CI and releases

Pull requests and pushes to `main` run formatting, linting, and tests on
`windows-2025` with Node.js `24.19.0`. Pull requests also run the production
build. Main-branch pushes package a Windows x64 portable EXE and ZIP and retain
them as a workflow artifact for 14 days.

Pushing an exact semantic-version tag triggers a release:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

The release workflow accepts only `vMAJOR.MINOR.PATCH`, repeats all validation,
builds both Windows artifacts, generates `SHA256SUMS.txt`, verifies the
checksums, and creates a GitHub Release with generated notes.

## Repository layout

```text
.github/workflows/  CI and tagged-release automation
docs/               storage integration and safety contract
scripts/            build identity generation
src/main/           Electron lifecycle, IPC, Realm scanner/index and guarded deletion manager
src/preload/        narrow context-bridge API
src/renderer/       React desktop interface
src/shared/         shared contracts, IPC names, and quick-search parser
tests/              query, search, and selection unit tests
```

## License and project status

Released under the [MIT License](LICENSE).

This is an unofficial community project. It is not affiliated with or endorsed
by ppy Pty Ltd. osu! and osu!lazer are trademarks of ppy Pty Ltd.
