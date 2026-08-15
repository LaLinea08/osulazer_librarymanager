import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import type {
  AppSettings,
  FilterGroup,
  LibraryCapabilities,
  LibraryQuery,
  ScanProgress,
  SerializableSelection,
} from "../shared/contracts";
import { BUILD_INFO } from "../shared/build-info.generated";
import { IPC } from "../shared/ipc";
import { AppDatabase, isSqliteAvailable } from "./database";
import { DeletionManager } from "./deletion-manager";
import {
  detectLibraryCandidates,
  inspectLibraryCandidate,
  isOsuRunning,
  scanRealmLibrary,
  unavailableCapabilities,
} from "./library-integration";
import { errorDetails, StructuredLogger } from "./logger";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const isDevelopment = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let database: AppDatabase | null = null;
let activeScan: AbortController | null = null;
let activeMutation: "delete" | "restore" | null = null;
let deletionManager: DeletionManager | null = null;
const logger = new StructuredLogger(
  join(app.getPath("userData"), "logs", "app.log"),
);

process.on("uncaughtException", (error) => {
  logger.write("error", "process.uncaught-exception", errorDetails(error));
});
process.on("unhandledRejection", (error) => {
  logger.write("error", "process.unhandled-rejection", errorDetails(error));
});

function requireDatabase(): AppDatabase {
  if (!database) throw new Error("The application database is not ready.");
  return database;
}

function requireDeletionManager(): DeletionManager {
  if (!deletionManager)
    throw new Error("The protected deletion service is not ready.");
  return deletionManager;
}

function senderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function emitProgress(progress: ScanProgress): void {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send(IPC.scanProgress, progress);
}

function cachedCapabilities(): LibraryCapabilities {
  const raw = requireDatabase().getMeta("capabilities_json");
  if (!raw) return unavailableCapabilities;
  try {
    return JSON.parse(raw) as LibraryCapabilities;
  } catch {
    return unavailableCapabilities;
  }
}

async function libraryStatus() {
  const db = requireDatabase();
  const settings = db.getSettings();
  return {
    configuredPath: settings.libraryPath,
    detectedCandidates: await detectLibraryCandidates(),
    capabilities: cachedCapabilities(),
    osuIsRunning: await isOsuRunning(),
    lastScanAt: db.getMeta("last_scan_at"),
    indexedDifficulties: db.getIndexedCount(),
    scanInProgress: activeScan !== null,
  };
}

function assertQuery(value: unknown): asserts value is LibraryQuery {
  if (!value || typeof value !== "object")
    throw new Error("Invalid library query.");
  const query = value as Partial<LibraryQuery>;
  if (
    typeof query.text !== "string" ||
    !query.filters ||
    !query.sort ||
    !Number.isFinite(query.offset) ||
    !Number.isFinite(query.limit)
  ) {
    throw new Error("Invalid library query.");
  }
}

function assertSelection(
  value: unknown,
): asserts value is SerializableSelection {
  if (!value || typeof value !== "object")
    throw new Error("Invalid selection.");
  const selection = value as Partial<SerializableSelection>;
  if (
    (selection.mode !== "explicit" && selection.mode !== "all-filtered") ||
    !Array.isArray(selection.included) ||
    !selection.included.every((id) => typeof id === "string") ||
    !Array.isArray(selection.excluded) ||
    !selection.excluded.every((id) => typeof id === "string")
  ) {
    throw new Error("Invalid selection.");
  }
}

async function performScan(allowDuringMutation = false): Promise<void> {
  if (activeScan) throw new Error("A library scan is already running.");
  if (activeMutation && !allowDuringMutation) {
    throw new Error("A protected library operation is already running.");
  }
  const db = requireDatabase();
  const path = db.getSettings().libraryPath;
  if (!path) throw new Error("Choose an osu!lazer library before scanning.");

  activeScan = new AbortController();
  const controller = activeScan;
  try {
    const result = await scanRealmLibrary(
      path,
      join(app.getPath("userData"), "realm-snapshots"),
      controller.signal,
      emitProgress,
    );
    db.replaceBeatmaps(result.records, path, result.sourceFingerprint);
    db.setMeta("capabilities_json", JSON.stringify(result.capabilities));
    db.setMeta("realm_schema_version", String(result.schemaVersion));
    db.setMeta("collection_count", String(result.collectionCount));
    db.addOperation({
      type: "scan",
      summary: `Indexed ${result.records.length.toLocaleString()} difficulties`,
      affectedDifficulties: result.records.length,
      affectedSets: new Set(
        result.records.map((record) => record.beatmapSetLocalId),
      ).size,
      status: result.missingResources > 0 ? "partial" : "success",
      details:
        result.missingResources > 0
          ? `${result.missingResources.toLocaleString()} referenced resources were unavailable.`
          : `Verified Realm schema ${result.schemaVersion}. Source database was not modified.`,
    });
    emitProgress({
      phase: "complete",
      processed: result.records.length,
      discovered: result.records.length,
      imported: result.records.length,
      skipped: result.missingResources,
      message: `Indexed ${result.records.length.toLocaleString()} difficulties safely.`,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The scan failed for an unknown reason.";
    db.addOperation({
      type: "scan",
      summary: "Library scan did not replace the previous index",
      affectedDifficulties: 0,
      affectedSets: 0,
      status: controller.signal.aborted ? "blocked" : "failed",
      details: message,
    });
    emitProgress({
      phase: "failed",
      processed: 0,
      discovered: 0,
      imported: 0,
      skipped: 0,
      message,
    });
    throw error;
  } finally {
    if (activeScan === controller) activeScan = null;
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.buildInfo, () => BUILD_INFO);
  ipcMain.handle(IPC.libraryStatus, libraryStatus);
  ipcMain.handle(IPC.chooseLibrary, async (event) => {
    const options: Electron.OpenDialogOptions = {
      title: "Choose osu!lazer data folder",
      properties: ["openDirectory"],
      message: "Choose the folder containing client.realm and files.",
    };
    const parent = senderWindow(event);
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const candidate = await inspectLibraryCandidate(
      result.filePaths[0],
      "manual",
    );
    if (!candidate.hasRealmDatabase || !candidate.hasFileStore) {
      throw new Error(
        "That folder is not an osu!lazer data root. It must contain client.realm and files.",
      );
    }
    return candidate;
  });
  ipcMain.handle(IPC.setLibraryPath, async (_event, path: unknown) => {
    if (typeof path !== "string" || !path.trim())
      throw new Error("Invalid library path.");
    const candidate = await inspectLibraryCandidate(path, "manual");
    if (!candidate.hasRealmDatabase || !candidate.hasFileStore) {
      throw new Error("That folder must contain both client.realm and files.");
    }
    requireDatabase().updateSettings({ libraryPath: candidate.path });
    return libraryStatus();
  });
  ipcMain.handle(IPC.startScan, () => performScan());
  ipcMain.handle(IPC.cancelScan, () => activeScan?.abort());
  ipcMain.handle(IPC.queryLibrary, (_event, query: unknown) => {
    assertQuery(query);
    return requireDatabase().query(query);
  });
  ipcMain.handle(IPC.queryLibraryIds, (_event, query: unknown) => {
    assertQuery(query);
    return requireDatabase().queryIds(query);
  });
  ipcMain.handle(IPC.statistics, (_event, filters: FilterGroup) =>
    requireDatabase().getStatistics(filters),
  );
  ipcMain.handle(IPC.getSettings, () => requireDatabase().getSettings());
  ipcMain.handle(IPC.updateSettings, (_event, settings: Partial<AppSettings>) =>
    requireDatabase().updateSettings(settings),
  );
  ipcMain.handle(IPC.getSavedSearches, () =>
    requireDatabase().getSavedSearches(),
  );
  ipcMain.handle(
    IPC.saveSearch,
    (_event, name: string, query: Omit<LibraryQuery, "offset" | "limit">) =>
      requireDatabase().saveSearch(name, query),
  );
  ipcMain.handle(IPC.deleteSavedSearch, (_event, id: string) =>
    requireDatabase().deleteSavedSearch(id),
  );
  ipcMain.handle(IPC.operationHistory, () =>
    requireDatabase().getOperationHistory(),
  );
  ipcMain.handle(
    IPC.previewDeletion,
    async (_event, query: unknown, selection: unknown) => {
      if (activeScan || activeMutation) {
        throw new Error("Wait for the current library operation to finish.");
      }
      assertQuery(query);
      assertSelection(selection);
      return requireDeletionManager().previewDeletion(query, selection);
    },
  );
  ipcMain.handle(
    IPC.executeDeletion,
    async (event, previewId: unknown, confirmationPhrase: unknown) => {
      if (
        typeof previewId !== "string" ||
        typeof confirmationPhrase !== "string" ||
        previewId.length > 100 ||
        confirmationPhrase.length > 100
      ) {
        throw new Error("Invalid deletion confirmation.");
      }
      if (activeScan || activeMutation) {
        throw new Error("Wait for the current library operation to finish.");
      }
      const parent = senderWindow(event);
      const options: Electron.MessageBoxOptions = {
        type: "warning",
        title: "Final protected-write confirmation",
        message: "Create a verified recovery backup and queue these sets?",
        detail:
          "No source resource will be deleted by this app. It will back up client.realm and every referenced target blob, then set osu!lazer’s official DeletePending flag in one transaction.",
        buttons: ["Cancel", "Back up and queue deletion"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      };
      const confirmation = parent
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options);
      if (confirmation.response !== 1) throw new Error("Deletion cancelled.");
      if (activeScan || activeMutation) {
        throw new Error(
          "Another library operation started while confirmation was open. Review the deletion again.",
        );
      }

      activeMutation = "delete";
      try {
        const result = await requireDeletionManager().executeDeletion(
          previewId,
          confirmationPhrase,
        );
        try {
          await performScan(true);
          return { ...result, indexRefreshed: true };
        } catch (error) {
          return {
            ...result,
            indexRefreshed: false,
            message: `${result.message} The local index could not refresh: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          };
        }
      } finally {
        activeMutation = null;
      }
    },
  );
  ipcMain.handle(IPC.getQuarantineRecords, () =>
    requireDeletionManager().getQuarantineRecords(),
  );
  ipcMain.handle(IPC.restoreQuarantine, async (event, operationId: unknown) => {
    if (typeof operationId !== "string" || operationId.length > 100) {
      throw new Error("Invalid quarantine operation.");
    }
    if (activeScan || activeMutation) {
      throw new Error("Wait for the current library operation to finish.");
    }
    const parent = senderWindow(event);
    const options: Electron.MessageBoxOptions = {
      type: "info",
      title: "Restore queued beatmap sets",
      message: "Clear the queued deletion before osu!lazer starts?",
      detail:
        "A fresh pre-restore Realm copy will be verified first. This works only while the target Realm rows still exist.",
      buttons: ["Cancel", "Create backup and restore"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const confirmation = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    if (confirmation.response !== 1) throw new Error("Restore cancelled.");
    if (activeScan || activeMutation) {
      throw new Error(
        "Another library operation started while confirmation was open. Try the restore again.",
      );
    }

    activeMutation = "restore";
    try {
      const result =
        await requireDeletionManager().restoreQuarantine(operationId);
      if (result.status !== "restored") return result;
      try {
        await performScan(true);
        return { ...result, indexRefreshed: true };
      } catch (error) {
        return {
          ...result,
          indexRefreshed: false,
          message: `${result.message} The local index could not refresh: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        };
      }
    } finally {
      activeMutation = null;
    }
  });
  ipcMain.handle(
    IPC.copySelectionMetadata,
    (_event, query: unknown, selection: unknown) => {
      assertQuery(query);
      assertSelection(selection);
      const lines = requireDatabase().selectionMetadata(query, selection);
      clipboard.writeText(lines.join("\n"));
      return lines.length;
    },
  );
  ipcMain.handle(IPC.copyText, (_event, text: unknown) => {
    if (typeof text !== "string" || text.length > 5_000_000)
      throw new Error("Invalid clipboard content.");
    clipboard.writeText(text);
  });
  ipcMain.handle(IPC.openExternal, async (_event, input: unknown) => {
    if (typeof input !== "string") throw new Error("Invalid URL.");
    const url = new URL(input);
    if (url.protocol !== "https:")
      throw new Error("Only HTTPS links can be opened.");
    await shell.openExternal(url.toString());
  });
}

function createWindow(): void {
  logger.write("info", "window.creating");
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1120,
    minHeight: 700,
    show: false,
    backgroundColor: "#cfd2cd",
    autoHideMenuBar: true,
    title: "osu!lazer Library Manager",
    webPreferences: {
      preload: join(currentDirectory, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription) => {
      logger.write("error", "renderer.load-failed", {
        errorCode,
        errorDescription,
      });
    },
  );
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logger.write("error", "renderer.process-gone", {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  mainWindow.once("ready-to-show", () => {
    logger.write("info", "window.ready-to-show");
    mainWindow?.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    logger.write("info", "renderer.loading-development-url");
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    logger.write("info", "renderer.loading-packaged-file");
    void mainWindow.loadFile(join(currentDirectory, "../renderer/index.html"));
  }
}

app.setAppUserModelId("dev.lalinea08.osulazerlibrarymanager");
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

logger.write("info", "app.module-loaded", {
  version: BUILD_INFO.version,
  packaged: app.isPackaged,
});

void app
  .whenReady()
  .then(async () => {
    if (!hasSingleInstanceLock) return;
    logger.write("info", "app.ready");
    if (!isSqliteAvailable())
      throw new Error(
        "This build does not include the required Node SQLite module.",
      );
    database = new AppDatabase(
      join(app.getPath("userData"), "library-index.sqlite"),
    );
    logger.write("info", "database.ready");
    deletionManager = new DeletionManager({
      database: requireDatabase,
      quarantineRoot: join(app.getPath("userData"), "quarantine"),
    });
    await deletionManager.reconcileManifests();
    logger.write("info", "deletion-safety.ready");
    registerIpc();
    logger.write("info", "ipc.ready");
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error: unknown) => {
    logger.write("error", "app.startup-failed", errorDetails(error));
    dialog.showErrorBox(
      "osu!lazer Library Manager could not start",
      error instanceof Error
        ? error.message
        : "An unknown startup error occurred.",
    );
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  activeScan?.abort();
  deletionManager = null;
  database?.close();
  database = null;
});
