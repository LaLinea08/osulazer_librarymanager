# osu!lazer library integration

## Status and scope

This document defines the safety and compatibility contract for reading an
osu!lazer library. It records the architecture verified on **2026-08-15** for
Realm schema **51** and describes the behavior implemented by
[`src/main/library-integration.ts`](../src/main/library-integration.ts).

The integration is deliberately read-only. It is a library browser and indexer,
not an external implementation of osu!lazer's database lifecycle. Any behavior
not explicitly listed as supported in the capability matrix must remain
disabled.

The important invariants are:

- Never open the user's `client.realm` with Realm.
- Never write, migrate, compact, recover, rename, or delete anything in the
  osu!lazer data root.
- Never treat the hashed `files` directory as a collection of independent
  beatmap folders.
- Never replace the last successful application index unless a complete scan
  has succeeded.
- Reject an unverified Realm schema instead of guessing.

## Verified storage architecture

osu!lazer does not have an osu!stable-style `Songs` directory. Its user data is
split between an authoritative Realm database and a content-addressed file
store.

```text
<lazer-data-root>/
|-- client.realm
|-- files/
|   `-- <hash[0]>/
|       `-- <hash[0..2]>/
|           `-- <full SHA-256 hash>
|-- storage.ini       # normally remains in the default data root
|-- framework.ini
`-- ...
```

For example, a resource with SHA-256
`1a47929b6056d34d25a95eeb2012395ceed66af6f40cc37c898a08482d6325d2`
is stored at:

```text
files/1/1a/1a47929b6056d34d25a95eeb2012395ceed66af6f40cc37c898a08482d6325d2
```

The physical filename has no useful extension. Original filenames and resource
ownership are stored in Realm. The same physical blob can be referenced by more
than one beatmap set, score, replay, or skin. Copying only `files/` is therefore
not a valid library backup, and moving one blob is not a valid quarantine
operation.

The current osu! source declares `client.realm` as the client database filename,
declares Realm schema version 51, and references Realm .NET 20.x. These are
implementation details rather than a public external API, so this application
still validates the schema at runtime.

## Data-root discovery

On Windows, automatic discovery proceeds as follows:

1. Construct the default candidate `%APPDATA%\osu`.
2. Read `%APPDATA%\osu\storage.ini`, if present.
3. Parse `FullPath = ...` and add that location as the preferred custom-storage
   candidate. Relative values are resolved against the default root.
4. Inspect both the custom and default candidates.
5. Assign high confidence only when a candidate contains both a regular
   `client.realm` file and a `files` directory.
6. If automatic discovery is inconclusive, ask the user to select the data root.

If the user selects `files/` itself, the adapter normalizes the selection to its
parent before validation. A path containing only `client.realm` or only `files/`
is not scan-ready.

osu!lazer deliberately keeps `storage.ini` out of normal data migration. A
configured custom path may also be inaccessible, empty, or stale, so the value
in `storage.ini` is only a candidate and never proof of a valid library.

## Realm schema 51 model map

The following models are relevant to the current reader. `MapTo` names are the
names queried from Realm, which do not always match the C# class names.

| Realm object          | osu! class            | Relevant persisted meaning                                                                                                                                          |
| --------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BeatmapSet`          | `BeatmapSetInfo`      | Local GUID, online set ID, date added, submitted/ranked dates, status, difficulties, files, protected and pending-deletion state                                    |
| `Beatmap`             | `BeatmapInfo`         | Local GUID, difficulty name, ruleset, difficulty values, metadata, set link, online beatmap ID, length, BPM, hashes, star rating, status, hidden state, last played |
| `BeatmapMetadata`     | `BeatmapMetadata`     | Artist/title, Unicode variants, mapper, source, tags, user tags, preview time, logical audio/background filenames                                                   |
| `BeatmapDifficulty`   | `BeatmapDifficulty`   | AR, OD, CS, HP, slider multiplier, and slider tick rate                                                                                                             |
| `Ruleset`             | `RulesetInfo`         | Ruleset short name, online ID, and display/instantiation metadata                                                                                                   |
| `File`                | `RealmFile`           | Primary-key SHA-256 hash and backlinks to file usages                                                                                                               |
| `RealmNamedFileUsage` | `RealmNamedFileUsage` | Embedded mapping from an original logical filename to a `File` object                                                                                               |
| `Score`               | `ScoreInfo`           | Score metadata, exact beatmap-content hash, and an optional link to the matching local beatmap revision                                                             |
| `BeatmapCollection`   | `BeatmapCollection`   | Collection GUID/name and a list of beatmap MD5 hashes                                                                                                               |

The scanner requires schema version 51 and verifies these minimum shapes before
extracting data:

```text
BeatmapSet:
  ID OnlineID DateAdded Beatmaps Files DeletePending

Beatmap:
  ID DifficultyName Ruleset Difficulty Metadata BeatmapSet OnlineID
  Length BPM Hash StarRating LastPlayed Hidden

File:
  Hash

RealmNamedFileUsage:
  File Filename
```

Schema version alone is insufficient. A missing object or property is treated as
an unsupported schema even if the stored version number is 51.

### Resource lookup

`BeatmapSet.Files` is a collection of `RealmNamedFileUsage` values. Each usage
contains:

- `Filename`: the original filename within the imported set;
- `File.Hash`: the SHA-256 used to locate the physical blob.

The `.osu` file for a difficulty is the set resource whose `File.Hash` matches
`Beatmap.Hash`. Audio and background resources are located by matching the
case-insensitive logical names in `BeatmapMetadata.AudioFile` and
`BeatmapMetadata.BackgroundFile` against the set's named usages.

## Exact read-only snapshot workflow

A fresh scan uses this sequence:

1. Normalize and validate the selected library root.
2. Require both `client.realm` and `files/`.
3. Check for a running osu! process. On Windows this uses `tasklist.exe` and
   recognizes `osu!.exe`, `osu.exe`, and `osulazer.exe` case-insensitively.
4. If osu! is running, stop before copying and leave the previous cache intact.
5. Record the source Realm's size and modification time.
6. Create an application-owned temporary directory under
   Electron's `userData/realm-snapshots/<random UUID>`.
7. Copy `client.realm` to that directory.
8. Re-read the source size and modification time and check for a running osu!
   process again.
9. If either source stat changed, or osu! started, delete the snapshot and fail
   with `SOURCE_CHANGED`.
10. Read the schema version from the snapshot with `Realm.schemaVersion()`.
11. Open only the snapshot with:

    ```ts
    await Realm.open({
      path: snapshotPath,
      readOnly: true,
      disableFormatUpgrade: true,
    });
    ```

12. Assert `schemaVersion === 51` and validate the required object/property
    contract.
13. Read Realm objects into detached application DTOs. Managed Realm objects do
    not cross the scan boundary.
14. Close Realm before inspecting resources.
15. Stat referenced blobs in the original `files/` store using their deterministic
    hash paths. Missing or unreadable blobs receive size zero and increment the
    partial-scan warning count; they are never repaired.
16. Replace the application-owned SQLite beatmap index in one transaction only
    after extraction has completed successfully.
17. Close Realm on every path and delete the application-owned snapshot in a
    `finally` block.

The source database is never a Realm open path. This is significant because even
read-oriented Realm SDK operations can create coordination files, and opening a
database with the wrong migration/format configuration can change it. Any such
side effects are confined to a disposable application-owned copy.

Cancellation, invalid paths, a running game, source changes, unsupported schemas,
and read errors all preserve the previous SQLite index. The operation history
records that the attempted scan did not replace it.

## Indexed field semantics and limitations

### Identity

- `id` is the local Realm GUID and is the application's primary difficulty key.
- `beatmapId` and `beatmapSetId` contain positive online IDs only. Zero and
  negative sentinel values become `null`.
- Online IDs are not safe local primary keys. The game itself permits situations
  where more than one local record has the same online ID.
- `contentHash` is the SHA-256 of the encoded `.osu` difficulty file.
- Collections use beatmap MD5 hashes, not local GUIDs or online IDs.

### Metadata

- Artist, title, mapper, source, tags, and difficulty name come from persisted
  Realm metadata; the scanner does not parse every `.osu` file to reconstruct
  fields already indexed by lazer.
- User-voted tags are appended to the textual tag field when present.
- Unknown or missing text receives a visible fallback where needed.
- There is no verified persisted local favorite flag in these beatmap models.
  Favorites and custom tags must therefore remain app-owned unless a separate,
  supported online integration is introduced.

### Rulesets and status

Ruleset short names map as follows:

| Realm short name    | Application mode |
| ------------------- | ---------------- |
| `osu`               | `osu`            |
| `taiko`             | `taiko`          |
| `fruits` or `catch` | `catch`          |
| `mania`             | `mania`          |
| anything else       | `unknown`        |

Persisted status integers map as follows:

| Value | Meaning                                                               |
| ----: | --------------------------------------------------------------------- |
|  `-4` | locally modified (currently represented as `unknown` by the UI model) |
|  `-3` | unknown/none                                                          |
|  `-2` | graveyard                                                             |
|  `-1` | WIP                                                                   |
|   `0` | pending                                                               |
|   `1` | ranked                                                                |
|   `2` | approved                                                              |
|   `3` | qualified                                                             |
|   `4` | loved                                                                 |

The difficulty status is preferred, with set status as a fallback.

### Difficulty and timing values

- `Length` is persisted in milliseconds and converted to seconds.
- BPM, AR, OD, CS, and HP come from Realm's processed metadata.
- Non-positive BPM/length becomes unknown rather than a fabricated value.
- `StarRating == -1` means not yet calculated and becomes `null`.
- The persisted star rating is lazer's base value. It is not a complete
  ruleset/mod-specific difficulty model and may differ after conversions or mods.

### Import and play history

- `importedAt` is `BeatmapSet.DateAdded`; there is no distinct per-difficulty
  import timestamp.
- `rankedAt` is the set's persisted ranked date.
- `lastPlayedAt` is `Beatmap.LastPlayed`.
- A null last-play timestamp means "no recorded timestamp", which the UI may
  present as never played with that limitation understood.
- osu!lazer does not persist a count of every play attempt. `localPlayCount`
  therefore remains `null`.
- `localScoreCount` counts `Score` rows linked to the local beatmap GUID, falling
  back to rows whose `BeatmapHash` matches the difficulty content hash. A score
  row is not the same thing as a play attempt, and scores may be detached from a
  current beatmap record after content changes.

### Visibility and pending deletion

- Sets with `DeletePending == true` are excluded, matching osu!lazer's usable-set
  query behavior.
- Difficulties with `Hidden == true` are excluded from the current index.
- Protected state is readable but is not currently exposed as a write capability.

### Media and storage

- `hasBackground` means the metadata's logical background filename resolves to
  a resource in the set. It does not validate image decoding.
- `hasVideo` is inferred from logical resource extensions (`avi`, `flv`, `m4v`,
  `mkv`, `mov`, `mp4`, `webm`, or `wmv`).
- Resource byte sizes come from filesystem stats, because Realm does not persist
  them.
- Each set size sums its unique referenced hashes once.
- The same set size is repeated on every indexed difficulty in that set. Summing
  the storage column across difficulty rows therefore over-counts.
- The reported set size is a **logical set size**, not a deletion-recovery
  estimate. Blobs can be shared by other sets, scores, replays, or skins.
- A trustworthy reclaim estimate would require a complete global reference graph
  and may count a blob only when every Realm usage is removed. That is not
  currently implemented.
- Missing resources are recorded as zero bytes and make the scan partial; they
  are not classified as safe to delete or auto-repair.

## Capability matrix

| Capability                                        | Schema 51 | Notes                                                                                                                  |
| ------------------------------------------------- | :-------: | ---------------------------------------------------------------------------------------------------------------------- |
| Discover default/custom data root                 |    Yes    | Candidate must contain `client.realm` and `files/`                                                                     |
| Read beatmap/set metadata                         |    Yes    | Hidden difficulties and pending-deletion sets are excluded                                                             |
| Read ruleset and ranked status                    |    Yes    | Unknown values degrade to `unknown`                                                                                    |
| Read AR/OD/CS/HP, BPM, length, base stars         |    Yes    | Unknown and not-calculated values stay nullable                                                                        |
| Read set-added, ranked, and last-played dates     |    Yes    | Set-added is not per difficulty                                                                                        |
| Read local score presence/count                   |    Yes    | Score rows, not play attempts                                                                                          |
| Read collections                                  |  Limited  | The Realm model is readable; the current scan indexes only the collection count, and membership editing is unavailable |
| Compute logical set storage                       |    Yes    | Deduplicated inside a set; not reclaimable bytes                                                                       |
| Detect referenced missing blobs                   |    Yes    | Diagnostic only; no repair                                                                                             |
| Browse the last successful cache while osu! runs  |    Yes    | A fresh Realm scan is blocked                                                                                          |
| Fresh scan while osu! runs                        |    No     | Close osu! and retry                                                                                                   |
| Open/play URLs or app-owned metadata actions      |    Yes    | Must not mutate the lazer data root                                                                                    |
| Write app-owned tags, saved searches, and history |    Yes    | Stored only in the application's SQLite database                                                                       |
| Add/remove/rename osu! collections                |    No     | Requires a verified supported write interface                                                                          |
| Hide or delete a difficulty                       |    No     | The internal immediate delete path has no undo                                                                         |
| Delete/quarantine a set                           |    No     | Hashed blobs are shared; direct filesystem quarantine is invalid                                                       |
| Repair Realm or orphaned files                    |    No     | Diagnostic reporting only                                                                                              |
| Any direct `client.realm` or `files/` mutation    |    No     | Explicit safety boundary                                                                                               |

## Compatibility behavior

Compatibility is capability-based, not inferred from a marketing version string.
The current adapter accepts only:

1. a readable snapshot;
2. Realm schema version exactly 51; and
3. all required objects and properties listed above.

Behavior by condition:

| Condition                                        | Behavior                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Verified schema 51                               | Perform a fresh read-only snapshot scan                                                                             |
| Schema lower than 51                             | Do not migrate it; ask the user to let their installed osu! version upgrade its own data, then close osu! and retry |
| Schema higher than 51                            | Mark the adapter unsupported and retain cached browsing until that schema is reviewed and fixture-tested            |
| Version 51 but required shape differs            | Treat as unsupported; schema number alone is not sufficient                                                         |
| Realm file unreadable or format upgrade required | Fail without retrying against the source; preserve the previous cache                                               |
| osu! running or source changed during copy       | Abort the fresh scan and preserve the previous cache                                                                |
| Referenced blob missing                          | Complete as a partial scan with a diagnostic count                                                                  |

Adding support for another schema requires all of the following:

- Review the corresponding osu! source models and migration history.
- Add an anonymized or synthetic Realm fixture for that exact schema.
- Verify Realm JS can inspect it with format upgrades disabled.
- Verify every required relationship and nullable/sentinel behavior.
- Run large-library and missing-resource tests.
- Update this document and the adapter's explicit compatibility manifest.

Do not broaden acceptance to a version range merely because a sample database
appears to open.

## Why modification remains disabled

osu!lazer's internal management operations coordinate more than one record or
file:

- Set deletion first marks `DeletePending`.
- Startup cleanup removes beatmaps and their metadata, then removes physical
  files only after their global Realm usage count reaches zero.
- Single-difficulty deletion has a separate immediate path and explicitly has no
  undo.
- Saves change SHA-256 and MD5 values, update collection references, reconnect
  scores, update set hashes/status, and invalidate caches.
- Protected sets and Realm threading/transaction rules are enforced inside the
  game's management layer.
- Realm startup itself may migrate, compact, recover, back up, or replace a
  database under specific conditions.

Setting a flag or deleting a hash file externally would bypass that lifecycle.
There is no documented external local-library mutation API in the verified
sources. Until osu! exposes a supported IPC, CLI, or other management contract,
the application must keep `writeLibrary: false` and place all custom state in its
own database.

A future recoverable workflow may export selected content to an app-owned backup
and then hand a supported operation to osu!, but moving blobs out of `files/` is
never a valid quarantine design.

## Official primary sources

The conclusions above are based on official project source and documentation:

- [osu! releases](https://github.com/ppy/osu/releases)
- [User file storage wiki](https://github.com/ppy/osu/wiki/User-file-storage)
- [`OsuGameBase`: `client.realm`, generated warning, and whole-directory backup guidance](https://github.com/ppy/osu/blob/master/osu.Game/OsuGameBase.cs)
- [`RealmAccess`: schema history, schema 51, migrations, recovery, pending deletion cleanup, backup, and operation blocking](https://github.com/ppy/osu/blob/master/osu.Game/Database/RealmAccess.cs)
- [`RealmFileStore`: SHA-256 storage and zero-usage cleanup](https://github.com/ppy/osu/blob/master/osu.Game/Database/RealmFileStore.cs)
- [`OsuStorage`: custom storage and migration exclusions](https://github.com/ppy/osu/blob/master/osu.Game/IO/OsuStorage.cs)
- [`StorageConfigManager`: `storage.ini` and `FullPath`](https://github.com/ppy/osu/blob/master/osu.Game/Configuration/StorageConfigManager.cs)
- [`BeatmapSetInfo`](https://github.com/ppy/osu/blob/master/osu.Game/Beatmaps/BeatmapSetInfo.cs)
- [`BeatmapInfo`](https://github.com/ppy/osu/blob/master/osu.Game/Beatmaps/BeatmapInfo.cs)
- [`BeatmapMetadata`](https://github.com/ppy/osu/blob/master/osu.Game/Beatmaps/BeatmapMetadata.cs)
- [`BeatmapDifficulty`](https://github.com/ppy/osu/blob/master/osu.Game/Beatmaps/BeatmapDifficulty.cs)
- [`RulesetInfo`](https://github.com/ppy/osu/blob/master/osu.Game/Rulesets/RulesetInfo.cs)
- [`RealmFile`](https://github.com/ppy/osu/blob/master/osu.Game/Models/RealmFile.cs)
- [`RealmNamedFileUsage`](https://github.com/ppy/osu/blob/master/osu.Game/Models/RealmNamedFileUsage.cs)
- [`ScoreInfo`](https://github.com/ppy/osu/blob/master/osu.Game/Scoring/ScoreInfo.cs)
- [`BeatmapCollection`](https://github.com/ppy/osu/blob/master/osu.Game/Collections/BeatmapCollection.cs)
- [`BeatmapOnlineStatus`](https://github.com/ppy/osu/blob/master/osu.Game/Beatmaps/BeatmapOnlineStatus.cs)
- [`BeatmapManager`: query, hide, save, score-linking, and deletion behavior](https://github.com/ppy/osu/blob/master/osu.Game/Beatmaps/BeatmapManager.cs)
- [`ModelManager`: soft-deletion transaction behavior](https://github.com/ppy/osu/blob/master/osu.Game/Database/ModelManager.cs)
- [Realm usage rules](https://github.com/ppy/osu/wiki/Realm-usage-rules)
- [`osu.Game.csproj`: current Realm dependency](https://github.com/ppy/osu/blob/master/osu.Game/osu.Game.csproj)
- [Realm JS implementation: existing-file schema discovery, immutable read-only mode, schema inspection, and schema-version inspection](https://github.com/realm/realm-js/blob/main/packages/realm/src/Realm.ts)

These links intentionally point to official upstream material. Because `master`
can change, future compatibility reviews should record the release/tag or commit
used to add each new schema adapter.
