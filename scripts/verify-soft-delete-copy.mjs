import {
  appendFile,
  copyFile,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import Realm from "realm";

const source = process.argv[2] ? resolve(process.argv[2]) : null;
const progressLog = process.argv[3] ? resolve(process.argv[3]) : null;
if (!source || basename(source).toLowerCase() !== "client.realm") {
  throw new Error("Pass the path to an existing client.realm file.");
}

const before = await stat(source);
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "osu-library-manager-soft-delete-"),
);
const copy = join(temporaryDirectory, "client.realm");

if (progressLog) await writeFile(progressLog, "", "utf8");
const mark = async (message) => {
  console.error(message);
  if (progressLog)
    await appendFile(
      progressLog,
      `${new Date().toISOString()} ${message}\n`,
      "utf8",
    );
};

let realm;
try {
  await mark("Copying client.realm into an isolated temporary directory…");
  await copyFile(source, copy);
  const schemaVersion = Realm.schemaVersion(copy);
  await mark(
    `Opening temporary Realm schema ${schemaVersion} for a reversible flag test…`,
  );
  realm = await Realm.open({
    path: copy,
    disableFormatUpgrade: true,
  });
  await mark("Temporary Realm opened writable.");

  const candidate = Array.from(realm.objects("BeatmapSet")).find((value) => {
    const set = value;
    return !set.DeletePending && !set.Protected;
  });
  if (!candidate)
    throw new Error("No deletable beatmap set exists in the copy.");

  const setId = String(candidate.ID);
  realm.write(() => {
    candidate.DeletePending = true;
  });
  await mark("DeletePending=true committed in the temporary Realm.");
  if (!candidate.DeletePending)
    throw new Error("The temporary DeletePending write did not persist.");
  realm.write(() => {
    candidate.DeletePending = false;
  });
  await mark("DeletePending=false rollback committed in the temporary Realm.");
  if (candidate.DeletePending)
    throw new Error("The temporary DeletePending rollback did not persist.");
  realm.close();
  realm = undefined;
  await mark(
    "Temporary flag write and rollback completed; reopening read-only…",
  );

  const verification = await Realm.open({
    path: copy,
    readOnly: true,
    disableFormatUpgrade: true,
  });
  const verified = Array.from(verification.objects("BeatmapSet")).find(
    (value) => String(value.ID) === setId,
  );
  const rolledBack = verified?.DeletePending === false;
  verification.close();
  await mark("Read-only reopen verified the rollback.");

  const after = await stat(source);
  const sourceUnchanged =
    before.size === after.size && before.mtimeMs === after.mtimeMs;
  if (!sourceUnchanged)
    throw new Error("The source client.realm metadata changed unexpectedly.");
  if (!rolledBack)
    throw new Error(
      "The temporary copy did not reopen in the rolled-back state.",
    );

  console.log(
    JSON.stringify(
      {
        schemaVersion,
        setId,
        temporaryWrite: true,
        rolledBack,
        sourceUnchanged,
      },
      null,
      2,
    ),
  );
} finally {
  if (realm && !realm.isClosed) realm.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
  await mark("Temporary directory removed.");
}

// Realm's native coordination worker can keep a standalone Node diagnostic
// alive after every Realm has closed. The Electron application stays open by
// design; this one-shot verification script should terminate explicitly.
process.exit(0);
