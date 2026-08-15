import type { AppApi } from "../../shared/contracts";

declare global {
  interface Window {
    libraryManager: AppApi;
  }
}

export {};
