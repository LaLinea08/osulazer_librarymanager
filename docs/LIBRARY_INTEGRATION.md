# osu!lazer library integration

## Status and scope

This document defines the safety and compatibility contract for scanning and
guarded whole-set maintenance of an osu!lazer library. It records the
architecture verified on **2026-08-15** for Realm schema **51** and describes
the behavior implemented by
[`src/main/library-integration.ts`](../src/main/library-integration.ts) and
[`src/main/deletion-manager.ts`](../src/main/deletion-manager.ts).

Indexing remains deliberately read-only: the scanner opens only an app-owned
snapshot and writes extracted data only to the application's SQLite database.
The deletion manager is one explicit, tightly guarded exception. It reproduces
the reviewed schema-51 whole-set `DeletePending` transition after creating a
verified recovery package. This is an **unsupported external maintenance
integration**, not an official osu! API.

The scan invariants are:

- Never open the user's `client.realm` with Realm while scanning.
- Never replace the last successful application index unless a complete scan
  has succeeded.
- Reject an unverified Realm schema or shape instead of guessing.
- Treat the hashed `files` directory as a shared content store, never as
  independent beatmap folders.

The mutation invariants are:

- Support complete beatmap sets only; selecting a difficulty expands to its
  containing set.
- Require schema 51, a closed osu! process, an exact source fingerprint match,
  and an unchanged selected-set file graph.
- Treat `Protected` as a hard block and reject sets already pending deletion.
- Finish and verify a full Realm copy, every blob referenced by the selected
  sets, a manifest, and one `.olz` archive per set before touching the source.
- In one Realm transaction, change only `BeatmapSet.DeletePending`; never delete
  Realm objects or move/delete source blobs directly.
- Permit automatic undo only while the records still exist and osu! remains
  closed; otherwise retain `.olz` archives for manual re-import.
- Make no promise that a logical set byte total will be physically reclaimed.

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

## Guarded whole-set deletion workflow

The deletion flow deliberately mirrors only osu!lazer's reversible whole-set
transition. Upstream's set-delete UI calls `BeatmapManager.Delete(set)`, whose
base `ModelManager.Delete()` operation sets `DeletePending = true`. On a later
osu! startup, `RealmAccess` removes pending records and asks `RealmFileStore` to
delete only blobs whose global Realm usage count has reached zero. This manager
queues the flag and leaves record and blob cleanup to osu! itself.

There is no reviewed external IPC, CLI, or public API for this operation. The
implementation therefore fails closed and performs the following sequence:

1. Resolve selected difficulty IDs from the last successful index and expand
   them to an exact, deduplicated set-ID list. A subset of a set is never a valid
   deletion target.
2. Apply the default-on played-set policy across every difficulty in each local
   set, not merely the selected or currently filtered difficulties. A set is
   skipped when any difficulty has a `LastPlayed` timestamp, a linked or
   hash-matching local `Score` row, or a positive play count from a compatible
   adapter. Hidden difficulties participate in this check.
3. Require the configured data root, Realm schema 51, a closed osu! process, and
   an indexed source fingerprint that exactly matches the live `client.realm`.
4. Require the exact `DELETE 1 SET` or `DELETE N SETS` confirmation phrase for
   the eligible sets remaining after the policy is applied.
5. Create an app-owned operation directory and a preparing manifest.
6. Copy the complete `client.realm` and verify its size and SHA-256 digest.
7. Open only that backup read-only, resolve every selected set, and reject a
   missing, `Protected`, or already-pending set.
8. Copy every unique blob referenced by those sets to the operation directory,
   preserving its content-addressed path, and verify each byte count and SHA-256
   digest. Blobs shared among selected sets are stored once.
9. Build one standard ZIP-format `.olz` per set from its exact logical
   filenames. Reject unsafe paths, duplicate exact filenames, and archives with
   no top-level `.osu`; reopen each archive and verify every entry's size and
   hash.
10. Recheck free space, osu! process state, the source fingerprint, exact target
    count, whole-set play evidence, protection/pending state, and every live
    filename/hash relationship. If any target gained recorded play evidence,
    abort the whole operation before changing any flag.
11. Open the live Realm with format upgrades disabled and execute one
    transaction that changes only each target set's `DeletePending` field to
    `true`. If the transaction throws, Realm rolls it back; the manager also
    verifies the flags after closing and reopening read-only.
12. Keep the recovery package and refresh the app-owned index. The manager does
    not delete, rename, or move any file in osu!'s `files/` tree.

### Recovery states

A queued operation remains automatically reversible only before osu! finalizes
startup cleanup. With osu! closed, Recovery revalidates the configured root and
schema, verifies that every set record still exists, makes an additional
pre-restore Realm copy, and clears all target `DeletePending` flags in one
transaction. If any target record is gone, the operation is marked finalized
and no partial automatic restore is attempted.

The verified `.olz` files are retained in every recovery package. After
finalization they can be imported into osu! manually; osu!'s importer accepts
`.olz` as a ZIP archive and requires a valid top-level `.osu` entry. A re-import
can restore the beatmap content but is not a byte-for-byte rollback of every
piece of library history or application state.

The preview's byte count is the selected sets' logical size. It is useful for
scale and backup-space planning, but it is not a promise of physical bytes
reclaimed. Other sets, scores, replays, or skins may share a blob, and osu!'s
own zero-usage cleanup makes the final decision.

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
- The default-on played-set deletion policy is conservative. It protects the
  complete local set when **any** difficulty has a non-null `LastPlayed`, a
  positive `localScoreCount`, or a positive `localPlayCount` if a future
  compatible adapter can populate that field. These signals are combined with
  OR, because either a timestamp without a retained score or a retained score
  without a timestamp is sufficient recorded evidence.
- `localPlayCount` being `null` does not by itself classify a set as played or
  unplayed; the current adapter intentionally cannot provide that counter. No
  recorded evidence is not proof that a map was never played.
- The policy is evaluated by local set GUID. Offline sets and distinct local
  sets that happen to share an online set ID do not protect one another.

### Visibility and pending deletion

- Sets with `DeletePending == true` are excluded, matching osu!lazer's usable-set
  query behavior.
- Difficulties with `Hidden == true` are excluded from the browser index, but
  their recorded play evidence is included in the whole-set deletion guard.
- `BeatmapSet.Protected` is captured for guarded maintenance and is a hard
  deletion block. This is stricter than calling the generic object-level
  `Delete()` method directly and matches osu!'s guarded bulk-delete behavior.

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
  and may count a blob only when every Realm usage is removed. The deletion
  preview intentionally does not claim to provide that estimate.
- Deletion never removes blobs directly. osu!'s startup cleanup removes a blob
  only after its Realm usage count reaches zero.
- Missing resources are recorded as zero bytes and make the scan partial; they
  are not classified as safe to delete or auto-repair.

## Capability matrix

| Capability                                        | Schema 51 | Notes                                                                                                                           |
| ------------------------------------------------- | :-------: | ------------------------------------------------------------------------------------------------------------------------------- |
| Discover default/custom data root                 |    Yes    | Candidate must contain `client.realm` and `files/`                                                                              |
| Read beatmap/set metadata                         |    Yes    | Hidden difficulties and pending-deletion sets are excluded                                                                      |
| Read ruleset and ranked status                    |    Yes    | Unknown values degrade to `unknown`                                                                                             |
| Read AR/OD/CS/HP, BPM, length, base stars         |    Yes    | Unknown and not-calculated values stay nullable                                                                                 |
| Read set-added, ranked, and last-played dates     |    Yes    | Set-added is not per difficulty                                                                                                 |
| Read local score presence/count                   |    Yes    | Score rows, not play attempts                                                                                                   |
| Protect complete sets with recorded play evidence |  Guarded  | Default on; checks every difficulty using last-play timestamp, local Score rows, and any available positive play count          |
| Read collections                                  |  Limited  | The model is readable; only collection count is indexed and membership editing is unavailable                                   |
| Compute logical set storage                       |    Yes    | Deduplicated inside a set; not promised reclaimable bytes                                                                       |
| Detect referenced missing blobs                   |    Yes    | Diagnostic only; missing target blobs block guarded deletion                                                                    |
| Browse the last successful cache while osu! runs  |    Yes    | Fresh scans and all maintenance are blocked                                                                                     |
| Fresh scan while osu! runs                        |    No     | Close osu! and retry                                                                                                            |
| Queue complete sets for deletion                  |  Guarded  | Unsupported external integration; exact schema/root/fingerprint/graph checks, protected-set block, and verified backup required |
| Undo a queued whole-set deletion                  |  Guarded  | Only before osu! cleanup, with all records present and osu! closed                                                              |
| Recover finalized content from `.olz`             |  Manual   | Retained archives can be re-imported; not a complete history rollback                                                           |
| Delete or hide one difficulty                     |    No     | Upstream's immediate difficulty-delete path has no undo                                                                         |
| Delete or move a source blob directly             |    No     | Blobs are shared; only osu!'s reference-aware cleanup may remove them                                                           |
| Set or clear `BeatmapSet.DeletePending`           |  Guarded  | The only live Realm property this application changes, for an exact set list in one transaction                                 |
| Open/play URLs or app-owned metadata actions      |    Yes    | No lazer data-root mutation                                                                                                     |
| Write app-owned tags, saved searches, and history |    Yes    | Stored only in the application's SQLite database                                                                                |
| Add/remove/rename osu! collections                |    No     | No verified supported write interface                                                                                           |
| Repair Realm or orphaned files                    |    No     | Diagnostic reporting only                                                                                                       |

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
| Guarded deletion on verified schema 51           | Continue only after all backup, process, fingerprint, protection, and graph checks pass                             |
| Deletion source differs from indexed fingerprint | Block before backup/write and require a fresh scan                                                                  |
| Deletion target is protected or already pending  | Block the entire operation; never queue a partial selection                                                         |
| Played-set protection finds recorded evidence    | Skip that complete local set; never delete only its unplayed difficulties                                           |
| A target gains play evidence after preview       | Abort before the transaction; never queue a partial selection                                                       |
| osu! starts or live set graph changes mid-flow   | Block before the transaction; retain any completed app-owned recovery package                                       |
| Undo target was finalized by osu!                | Do not partially recreate Realm records; retain verified `.olz` archives for manual import                          |

Adding support for another schema requires all of the following:

- Review the corresponding osu! source models and migration history.
- Add an anonymized or synthetic Realm fixture for that exact schema.
- Verify Realm JS can inspect it with format upgrades disabled.
- Verify every required relationship and nullable/sentinel behavior.
- Run large-library and missing-resource tests.
- Update this document and the adapter's explicit compatibility manifest.

Do not broaden acceptance to a version range merely because a sample database
appears to open.

## Why the guarded write is narrow

osu!lazer's internal management operations coordinate more than one record or
file. Set deletion is unusually suitable for a guarded external queue because
the first transition is reversible: it sets `DeletePending`, and the game's own
later startup cleanup removes the records and only zero-usage blobs. The manager
implements exactly that initial transition for a fixed set list and backs up
everything needed for recovery first.

It does not claim parity with osu!'s in-process management layer. In particular,
osu!'s internal backup and operation-blocking APIs are not available over IPC,
and the reviewed desktop command handling supports imports and osu! links rather
than library maintenance. The manager compensates by requiring the game to be
closed, checking a stable fingerprint and exact object graph repeatedly, opening
with format upgrades disabled, using one transaction, and verifying the result.
Those checks reduce risk but do not turn the integration into a supported API.

All broader mutation remains disabled:

- Single-difficulty deletion is an immediate upstream path with no undo.
- Saves can change SHA-256 and MD5 values, update collection references,
  reconnect scores, update set hashes/status, and invalidate caches.
- Collection changes, hiding, metadata edits, migration, compaction, recovery,
  and Realm repair require lifecycle behavior this application does not own.
- Directly deleting or moving a hash file bypasses shared-reference accounting
  and is never a valid quarantine design.

Custom tags, filters, operation records, manifests, Realm copies, blob copies,
and `.olz` archives therefore remain app-owned. The only source-data write is
the guarded `DeletePending` true/false transition documented above.

## Official primary sources

The deletion contract was reviewed against official osu! source commit
[`fc39aa5`](https://github.com/ppy/osu/commit/fc39aa5cecd3d87576107506fe8036fc891111bc)
from 2026-08-14. Pinning line links to that commit prevents a later `master`
change from silently changing this document's evidence.

### Database and deletion lifecycle

- [`BeatmapDeleteDialog` calls the beatmap manager for a complete set](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Screens/Select/BeatmapDeleteDialog.cs#L10-L24).
- [`ModelManager.Delete()` and `Undelete()` set and clear `DeletePending` in write transactions](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Database/ModelManager.cs#L192-L226).
- [`BeatmapManager` bulk deletion excludes pending and protected sets](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Beatmaps/BeatmapManager.cs#L413-L425),
  while its [single-difficulty path is immediate and explicitly has no undo](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Beatmaps/BeatmapManager.cs#L427-L452).
- [`BeatmapSetInfo` persists `Files`, `Protected`, and `DeletePending`](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Beatmaps/BeatmapSetInfo.cs#L43-L65).
- [`RealmAccess` invokes pending-deletion cleanup during startup](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Database/RealmAccess.cs#L208-L217)
  and [deletes pending objects before handing unused files to the file store](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Database/RealmAccess.cs#L382-L429).
- [`RealmFile` uses the SHA-256 hash as its primary key and exposes usage backlinks](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Models/RealmFile.cs#L9-L18),
  and [`RealmNamedFileUsage` binds each logical filename to a Realm file](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Models/RealmNamedFileUsage.cs#L12-L23).
- [`RealmFileStore` deduplicates content by hash](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Database/RealmFileStore.cs#L44-L59)
  and [removes a blob only when it has zero usages](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Database/RealmFileStore.cs#L91-L120).
- [The deterministic `files/<first>/<first-two>/<hash>` path](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Extensions/ModelExtensions.cs#L17-L24)
  is derived from the content hash.
- [Schema 51 and its migration boundary](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Database/RealmAccess.cs#L75-L105)
  and [the Realm .NET dependency](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/osu.Game.csproj#L39-L43)
  are internal implementation details.
- [`RealmAccess` backup and operation-blocking methods are in-process services](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Database/RealmAccess.cs#L1330-L1455).
  The [desktop command entry point handles osu! links and imports](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Desktop/Program.cs#L153-L177),
  while the [reviewed IPC surface](https://github.com/ppy/osu/tree/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/IPC)
  contains no external delete or backup command.

### Recovery archive compatibility

- [`BeatmapExporter` uses `.olz` for lazer beatmap exports](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Database/BeatmapExporter.cs#L13-L22).
- [`LegacyArchiveExporter` writes a UTF-8 standard ZIP containing every named set file and rejects duplicate exact names](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Database/LegacyArchiveExporter.cs#L39-L88).
- [`BeatmapImporter` accepts `.osz` and `.olz`](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Beatmaps/BeatmapImporter.cs#L29-L34),
  [recognizes the ZIP signature](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Database/ImportTask.cs#L47-L70),
  and [requires a valid top-level `.osu` file](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Beatmaps/BeatmapImporter.cs#L309-L317).
- [Archive imports standardize paths and reject traversal outside storage](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Database/RealmArchiveModelImporter.cs#L517-L525),
  while [exact duplicate entries are ambiguous to the ZIP reader](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/IO/Archives/ZipArchiveReader.cs#L55-L61).

### Related data semantics and SDK behavior

- [`BeatmapInfo` documents score links surviving beatmap removal](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Beatmaps/BeatmapInfo.cs#L205-L217),
  and [the importer reconnects matching scores](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Beatmaps/BeatmapImporter.cs#L230-L234).
- [`BeatmapCollection` stores beatmap MD5 hashes](https://github.com/ppy/osu/blob/fc39aa5cecd3d87576107506fe8036fc891111bc/osu.Game/Collections/BeatmapCollection.cs#L16-L36).
- The official [user file storage wiki](https://github.com/ppy/osu/wiki/User-file-storage)
  warns that the storage structure is implementation-managed.
- Realm JS configuration documents
  [`disableFormatUpgrade`](https://github.com/realm/realm-js/blob/5064bb5ed0bf7841ab2a94cd21f4c61fdeb38625/packages/realm/src/Configuration.ts#L61-L76)
  and [read-only/dynamic-schema options](https://github.com/realm/realm-js/blob/5064bb5ed0bf7841ab2a94cd21f4c61fdeb38625/packages/realm/src/Configuration.ts#L127-L138).
  Its [write implementation cancels the transaction when the callback throws](https://github.com/realm/realm-js/blob/5064bb5ed0bf7841ab2a94cd21f4c61fdeb38625/packages/realm/src/Realm.ts#L1049-L1072).

Future schema support requires a new source review, fixtures, tests, and an
updated pinned evidence set; a successful open alone is not compatibility proof.
