# osu!lazer Library Manager

[![CI](https://github.com/LaLinea08/osulazer_librarymanager/actions/workflows/ci.yml/badge.svg)](https://github.com/LaLinea08/osulazer_librarymanager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A fast, safety-first Windows desktop browser for large osu!lazer beatmap
libraries. It turns a verified read-only snapshot into a local SQLite index, so
you can explore, filter, and analyze your library without changing osu!lazer's
database or content store.

> [!IMPORTANT]
> This release is analysis-only. It never writes to `client.realm` or the
> content-addressed `files` store. Deletion, quarantine, collection editing,
> duplicate removal, and export are not implemented.

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
- Analysis-only storage and cleanup views for large sets, video-containing sets,
  old or missing play timestamps, and low persisted star ratings.
- A local operation history for successful, partial, failed, and blocked scans.
- Browsing of the last successful index while osu! is open. Fresh scans remain
  blocked until the game is closed.

Built-in library views include recently added, recently played, no recorded
play timestamp, ranked, loved, graveyard, and each of osu!'s four game modes.

## Compatibility and safety

The current adapter accepts **Realm schema 51 only**. A Realm schema is an
internal storage format, not an osu! release number. Earlier, later, or
shape-incompatible databases are rejected until their layouts have been
reviewed and tested.

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

- There is no supported osu!lazer mutation API, so the manager cannot delete,
  hide, restore, quarantine, rename, or move beatmaps or hashed resources.
- Collection membership editing, export, and duplicate analysis are not
  available. Their visible controls and pages remain disabled or informational.
- Storage totals are **logical set sizes**, deduplicated only within each set.
  Blobs may be shared by other sets, scores, replays, or skins, so these totals
  are not estimates of safely reclaimable disk space.
- `LastPlayed` is a recorded timestamp, not a full play history. Local score
  count measures stored score rows; osu!lazer does not persist a count of every
  play attempt in the indexed model.
- Star ratings are persisted base values and can be unavailable or differ after
  ruleset conversion and mods.
- Hidden difficulties and sets already marked pending deletion are excluded from
  the index.
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
src/main/           Electron lifecycle, IPC, Realm scanner, SQLite index
src/preload/        narrow context-bridge API
src/renderer/       React desktop interface
src/shared/         shared contracts, IPC names, and quick-search parser
tests/              query, search, and selection unit tests
```

## License and project status

Released under the [MIT License](LICENSE).

This is an unofficial community project. It is not affiliated with or endorsed
by ppy Pty Ltd. osu! and osu!lazer are trademarks of ppy Pty Ltd.
