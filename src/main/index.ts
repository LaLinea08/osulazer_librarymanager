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
} from "../shared/contracts";
import { BUILD_INFO } from "../shared/build-info.generated";
import { IPC } from "../shared/ipc";
import { AppDatabase, isSqliteAvailable } from "./database";
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
  ipcMain.handle(IPC.startScan, async () => {
    if (activeScan) throw new Error("A library scan is already running.");
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
      db.replaceBeatmaps(result.records, path);
      db.setMeta("capabilities_json", JSON.stringify(result.capabilities));
      db.setMeta("realm_schema_version", String(result.schemaVersion));
      db.setMeta("collection_count", String(result.collectionCount));
      db.addOperation({
        type: "scan",
        summary: `Indexed ${result.records.length.toLocaleString()} difficulties`,
        affectedDifficulties: result.records.length,
        affectedSets: new Set(
          result.records.map((record) => record.beatmapSetId ?? record.id),
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
  });
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
    IPC.copySelectionMetadata,
    (_event, query: unknown, selection: unknown) => {
      assertQuery(query);
      if (!selection || typeof selection !== "object")
        throw new Error("Invalid selection.");
      const value = selection as {
        mode?: unknown;
        included?: unknown;
        excluded?: unknown;
      };
      if (
        (value.mode !== "explicit" && value.mode !== "all-filtered") ||
        !Array.isArray(value.included) ||
        !Array.isArray(value.excluded)
      ) {
        throw new Error("Invalid selection.");
      }
      const lines = requireDatabase().selectionMetadata(query, {
        mode: value.mode,
        included: value.included.filter(
          (id): id is string => typeof id === "string",
        ),
        excluded: value.excluded.filter(
          (id): id is string => typeof id === "string",
        ),
      });
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
    backgroundColor: "#090b11",
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

logger.write("info", "app.module-loaded", {
  version: BUILD_INFO.version,
  packaged: app.isPackaged,
});

void app
  .whenReady()
  .then(() => {
    logger.write("info", "app.ready");
    if (!isSqliteAvailable())
      throw new Error(
        "This build does not include the required Node SQLite module.",
      );
    database = new AppDatabase(
      join(app.getPath("userData"), "library-index.sqlite"),
    );
    logger.write("info", "database.ready");
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
  database?.close();
  database = null;
});
