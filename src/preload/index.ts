import { contextBridge, ipcRenderer } from "electron";
import type {
  AppApi,
  AppSettings,
  FilterGroup,
  LibraryQuery,
  SerializableSelection,
  ScanProgress,
} from "../shared/contracts";
import { IPC } from "../shared/ipc";

const api: AppApi = {
  getBuildInfo: () => ipcRenderer.invoke(IPC.buildInfo),
  getLibraryStatus: () => ipcRenderer.invoke(IPC.libraryStatus),
  chooseLibrary: () => ipcRenderer.invoke(IPC.chooseLibrary),
  setLibraryPath: (path: string) =>
    ipcRenderer.invoke(IPC.setLibraryPath, path),
  startScan: () => ipcRenderer.invoke(IPC.startScan),
  cancelScan: () => ipcRenderer.invoke(IPC.cancelScan),
  onScanProgress: (listener: (progress: ScanProgress) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: ScanProgress,
    ): void => listener(progress);
    ipcRenderer.on(IPC.scanProgress, handler);
    return () => ipcRenderer.removeListener(IPC.scanProgress, handler);
  },
  queryLibrary: (query: LibraryQuery) =>
    ipcRenderer.invoke(IPC.queryLibrary, query),
  queryLibraryIds: (query: LibraryQuery) =>
    ipcRenderer.invoke(IPC.queryLibraryIds, query),
  getStatistics: (filters: FilterGroup) =>
    ipcRenderer.invoke(IPC.statistics, filters),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke(IPC.updateSettings, settings),
  getSavedSearches: () => ipcRenderer.invoke(IPC.getSavedSearches),
  saveSearch: (name, query) => ipcRenderer.invoke(IPC.saveSearch, name, query),
  deleteSavedSearch: (id: string) =>
    ipcRenderer.invoke(IPC.deleteSavedSearch, id),
  getOperationHistory: () => ipcRenderer.invoke(IPC.operationHistory),
  copySelectionMetadata: (
    query: LibraryQuery,
    selection: SerializableSelection,
  ) => ipcRenderer.invoke(IPC.copySelectionMetadata, query, selection),
  previewDeletion: (query: LibraryQuery, selection: SerializableSelection) =>
    ipcRenderer.invoke(IPC.previewDeletion, query, selection),
  executeDeletion: (previewId: string, confirmationPhrase: string) =>
    ipcRenderer.invoke(IPC.executeDeletion, previewId, confirmationPhrase),
  getQuarantineRecords: () => ipcRenderer.invoke(IPC.getQuarantineRecords),
  restoreQuarantine: (operationId: string) =>
    ipcRenderer.invoke(IPC.restoreQuarantine, operationId),
  copyText: (text: string) => ipcRenderer.invoke(IPC.copyText, text),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, url),
};

contextBridge.exposeInMainWorld("libraryManager", api);
